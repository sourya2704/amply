package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// Payments use Razorpay (test mode) when RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are set.
// Without keys, a clearly labelled mock provider follows the same order → verify → refund flow.
// Card details never touch our server: Razorpay Checkout collects them, and we only verify the signature.

type razorpay struct {
	keyID, secret, baseURL string
	http                   *http.Client
}

func (rp *razorpay) enabled() bool { return rp != nil && rp.keyID != "" && rp.secret != "" }

func (rp *razorpay) call(method, path string, body any, out any) error {
	b, _ := json.Marshal(body)
	req, err := http.NewRequest(method, rp.baseURL+path, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.SetBasicAuth(rp.keyID, rp.secret)
	req.Header.Set("Content-Type", "application/json")
	res, err := rp.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		return fmt.Errorf("razorpay %s %s: %d %s", method, path, res.StatusCode, data)
	}
	return json.Unmarshal(data, out)
}

// validSignature checks Razorpay's checkout signature: HMAC-SHA256(order_id + "|" + payment_id, key_secret).
func (rp *razorpay) validSignature(orderID, paymentID, signature string) bool {
	mac := hmac.New(sha256.New, []byte(rp.secret))
	mac.Write([]byte(orderID + "|" + paymentID))
	return hmac.Equal([]byte(hex.EncodeToString(mac.Sum(nil))), []byte(signature))
}

func (a *App) createPaymentOrder(w http.ResponseWriter, r *http.Request, u *User) {
	var body struct {
		BookingID string `json:"booking_id"`
	}
	if !readBody(w, r, &body) {
		return
	}
	a.expireStale()
	br := a.loadBookingFor(w, body.BookingID, u)
	if br == nil {
		return
	}
	if br.driverID != u.ID {
		writeError(w, 403, "FORBIDDEN", "Only the driver pays for a booking")
		return
	}
	if br.b.Status != "accepted" {
		writeError(w, 409, "INVALID_STATE", "Payment opens once the owner accepts (booking is "+br.b.Status+")")
		return
	}
	amount := br.b.Price.TotalPaise
	resp := map[string]any{"booking_id": br.b.ID, "amount_paise": amount, "currency": "INR",
		"name": "Amply", "description": br.b.Charger.Name + ", " + when(br.startTS)}

	// Reuse an open order for this booking so retries never create duplicate charges.
	var provider, orderID string
	err := a.db.QueryRow(`SELECT provider, provider_order_id FROM payments WHERE booking_id = ? AND status = 'created'
		ORDER BY created_at DESC LIMIT 1`, br.b.ID).Scan(&provider, &orderID)
	if err != nil {
		provider, orderID = "mock", "mock_order_"+uuid.NewString()[:12]
		if a.rzp.enabled() {
			var order struct {
				ID string `json:"id"`
			}
			if err := a.rzp.call("POST", "/v1/orders", map[string]any{"amount": amount, "currency": "INR", "receipt": br.b.ID[:36],
				"notes": map[string]string{"booking_id": br.b.ID}}, &order); err != nil {
				log.Printf("payments: %v", err)
				writeError(w, 502, "PAYMENT_FAILED", "Couldn't start the payment. Try again.")
				return
			}
			provider, orderID = "razorpay", order.ID
		}
		if _, err := a.db.Exec(`INSERT INTO payments (id, booking_id, provider, provider_order_id, amount_paise, status, created_at)
			VALUES (?,?,?,?,?,'created',?)`, uuid.NewString(), br.b.ID, provider, orderID, amount, a.now().Unix()); err != nil {
			serverError(w, err)
			return
		}
	}
	resp["provider"], resp["order_id"] = provider, orderID
	if provider == "razorpay" {
		resp["key_id"] = a.rzp.keyID
	}
	writeJSON(w, 200, resp)
}

func (a *App) verifyPayment(w http.ResponseWriter, r *http.Request, u *User) {
	var body struct {
		BookingID string `json:"booking_id"`
		OrderID   string `json:"razorpay_order_id"`
		PaymentID string `json:"razorpay_payment_id"`
		Signature string `json:"razorpay_signature"`
	}
	if !readBody(w, r, &body) {
		return
	}
	br := a.loadBookingFor(w, body.BookingID, u)
	if br == nil {
		return
	}
	if br.driverID != u.ID {
		writeError(w, 403, "FORBIDDEN", "Only the driver pays for a booking")
		return
	}
	var paymentID, provider string
	var amount int64
	err := a.db.QueryRow(`SELECT id, provider, amount_paise FROM payments WHERE booking_id = ? AND provider_order_id = ? AND status = 'created'`,
		br.b.ID, body.OrderID).Scan(&paymentID, &provider, &amount)
	if err != nil {
		writeError(w, 404, "NOT_FOUND", "No open payment for this booking")
		return
	}
	switch provider {
	case "razorpay":
		if !a.rzp.enabled() || body.PaymentID == "" || !a.rzp.validSignature(body.OrderID, body.PaymentID, body.Signature) {
			writeError(w, 402, "PAYMENT_FAILED", "Payment could not be verified")
			return
		}
	case "mock":
		if a.rzp.enabled() {
			writeError(w, 402, "PAYMENT_FAILED", "Mock payments are disabled when Razorpay is configured")
			return
		}
		body.PaymentID = "mock_pay_" + uuid.NewString()[:12]
	}

	tx, err := a.db.Begin()
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback()
	now := a.now().Unix()
	res, err := tx.Exec(`UPDATE payments SET status = 'paid', provider_payment_id = ? WHERE id = ? AND status = 'created'`, body.PaymentID, paymentID)
	if err != nil {
		serverError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 { // a concurrent verify already handled it
		tx.Rollback()
		a.respondBooking(w, 200, br.b.ID, u)
		return
	}
	meta := map[string]any{"payment_ref": body.PaymentID, "amount_paise": amount, "provider": provider}
	res, err = tx.Exec(`UPDATE bookings SET status = 'confirmed', status_changed_at = ? WHERE id = ? AND status = 'accepted'`, now, br.b.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		// Paid after the hold expired or was cancelled: give the money back straight away.
		ref, err := a.refundPayment(tx, paymentID, provider, body.PaymentID, amount, u.ID, now)
		if err != nil {
			serverError(w, err)
			return
		}
		if err := errors.Join(audit(tx, u.ID, "payment.refunded_late", "booking", br.b.ID, map[string]any{"refund_ref": ref}, now), tx.Commit()); err != nil {
			serverError(w, err)
			return
		}
		writeError(w, 409, "INVALID_STATE", "This booking is no longer active, so your payment was refunded")
		return
	}
	err = errors.Join(
		addEvent(tx, br.b.ID, u.ID, "confirmed", meta, now),
		audit(tx, u.ID, "payment.captured", "booking", br.b.ID, meta, now),
	)
	if br.ownerID != nil {
		err = errors.Join(err, notify(tx, *br.ownerID, "booking_confirmed", "Booking confirmed and paid",
			fmt.Sprintf("%s paid for %s on %s", br.b.Driver.Name, br.b.Charger.Name, when(br.startTS)), "/owner", now))
	}
	if err != nil {
		serverError(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		serverError(w, err)
		return
	}
	a.respondBooking(w, 200, br.b.ID, u)
}

// refundBooking refunds the paid payment of a booking in full (PRD: free cancellation before the session).
func (a *App) refundBooking(tx *Tx, bookingID, actorID string, now int64) (string, error) {
	var paymentID, provider string
	var providerPaymentID *string
	var amount int64
	if err := tx.QueryRow(`SELECT id, provider, provider_payment_id, amount_paise FROM payments WHERE booking_id = ? AND status = 'paid'
		ORDER BY created_at DESC LIMIT 1`, bookingID).Scan(&paymentID, &provider, &providerPaymentID, &amount); err != nil {
		return "", err
	}
	pid := ""
	if providerPaymentID != nil {
		pid = *providerPaymentID
	}
	ref, err := a.refundPayment(tx, paymentID, provider, pid, amount, actorID, now)
	if err != nil {
		return "", err
	}
	return ref, audit(tx, actorID, "payment.refunded", "booking", bookingID, map[string]any{"refund_ref": ref, "amount_paise": amount}, now)
}

func (a *App) refundPayment(tx *Tx, paymentID, provider, providerPaymentID string, amount int64, actorID string, now int64) (string, error) {
	ref, status := "mock_rfnd_"+uuid.NewString()[:12], "processed"
	if provider == "razorpay" {
		var out struct {
			ID string `json:"id"`
		}
		if err := a.rzp.call("POST", "/v1/payments/"+providerPaymentID+"/refund", map[string]any{"amount": amount}, &out); err != nil {
			// Don't block the cancellation; leave the refund pending for an admin to retry.
			log.Printf("refund failed, marked pending: %v", err)
			ref, status = "pending_"+paymentID[:8], "pending"
		} else {
			ref = out.ID
		}
	}
	if _, err := tx.Exec(`INSERT INTO refunds (id, payment_id, provider_ref, amount_paise, status, created_at) VALUES (?,?,?,?,?,?)`,
		uuid.NewString(), paymentID, ref, amount, status, now); err != nil {
		return "", err
	}
	_, err := tx.Exec(`UPDATE payments SET status = 'refunded' WHERE id = ?`, paymentID)
	return ref, err
}

func newRazorpay(keyID, secret string) *razorpay {
	return &razorpay{keyID: keyID, secret: secret, baseURL: "https://api.razorpay.com", http: &http.Client{Timeout: 15 * time.Second}}
}
