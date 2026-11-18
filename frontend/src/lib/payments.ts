import { api } from "./api";
import type { Booking, PaymentOrder } from "./types";

// Razorpay Checkout collects the card/UPI details on Razorpay's own form; we only ever see the
// order id, payment id and signature, which the backend verifies.

interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void; on: (e: string, cb: (r: unknown) => void) => void };
  }
}

function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Couldn't load the payment form. Check your connection."));
    document.body.appendChild(s);
  });
}

/** Runs the whole payment for an accepted booking and returns the confirmed booking. */
export async function payForBooking(bookingId: string, prefill: { name: string; email: string }): Promise<Booking> {
  const order = await api.post<PaymentOrder>("/api/payments/order", { booking_id: bookingId });
  if (order.provider === "mock") {
    await new Promise((r) => setTimeout(r, 900)); // simulated gateway round trip
    return api.post<Booking>("/api/payments/verify", { booking_id: bookingId, razorpay_order_id: order.order_id });
  }
  await loadCheckout();
  const result = await new Promise<RazorpayResponse>((resolve, reject) => {
    const rzp = new window.Razorpay!({
      key: order.key_id,
      order_id: order.order_id,
      amount: order.amount_paise,
      currency: order.currency,
      name: order.name,
      description: order.description,
      prefill,
      theme: { color: "#FFA3CF" },
      handler: resolve,
      modal: { ondismiss: () => reject(new Error("Payment cancelled")) },
    });
    rzp.on("payment.failed", () => reject(new Error("Payment failed. You haven't been charged.")));
    rzp.open();
  });
  return api.post<Booking>("/api/payments/verify", { booking_id: bookingId, ...result });
}
