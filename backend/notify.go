package main

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/google/uuid"
)

// systemActor is recorded for changes nobody clicked (e.g. an unanswered request expiring).
const systemActor = "system"

// notify stores an in-app notification for one user.
func notify(q querier, userID, typ, title, body, link string, ts int64) error {
	_, err := q.Exec(`INSERT INTO notifications (id, user_id, type, title, body, link, created_at) VALUES (?,?,?,?,?,?,?)`,
		uuid.NewString(), userID, typ, title, body, link, ts)
	return err
}

// audit records who did what, for admins (PRD §10: admin actions, payment changes, moderation, booking transitions).
func audit(q querier, actorID, action, resourceType, resourceID string, details map[string]any, ts int64) error {
	if details == nil {
		details = map[string]any{}
	}
	d, _ := json.Marshal(details)
	_, err := q.Exec(`INSERT INTO audit_logs (id, actor_id, action, resource_type, resource_id, details, created_at) VALUES (?,?,?,?,?,?,?)`,
		uuid.NewString(), actorID, action, resourceType, resourceID, string(d), ts)
	return err
}

type Notification struct {
	ID        string `json:"id"`
	Type      string `json:"type"`
	Title     string `json:"title"`
	Body      string `json:"body"`
	Link      string `json:"link"`
	Read      bool   `json:"read"`
	CreatedAt string `json:"created_at"`
}

func (a *App) listNotifications(w http.ResponseWriter, r *http.Request, u *User) {
	a.expireStale()
	rows, err := a.db.Query(`SELECT id, type, title, body, link, read, created_at FROM notifications
		WHERE user_id = ? ORDER BY seq DESC LIMIT 30`, u.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	items := []Notification{}
	unread := 0
	for rows.Next() {
		var n Notification
		var ts int64
		if err := rows.Scan(&n.ID, &n.Type, &n.Title, &n.Body, &n.Link, &n.Read, &ts); err != nil {
			serverError(w, err)
			return
		}
		n.CreatedAt = formatTS(ts)
		if !n.Read {
			unread++
		}
		items = append(items, n)
	}
	writeJSON(w, 200, map[string]any{"unread": unread, "items": items})
}

func (a *App) markNotificationsRead(w http.ResponseWriter, r *http.Request, u *User) {
	if _, err := a.db.Exec(`UPDATE notifications SET read = TRUE WHERE user_id = ? AND NOT read`, u.ID); err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(204)
}

type AuditEntry struct {
	ID           string         `json:"id"`
	ActorName    string         `json:"actor_name"`
	Action       string         `json:"action"`
	ResourceType string         `json:"resource_type"`
	ResourceID   string         `json:"resource_id"`
	Details      map[string]any `json:"details"`
	CreatedAt    string         `json:"created_at"`
}

func (a *App) adminAuditLogs(w http.ResponseWriter, r *http.Request, u *User) {
	limit, err := strconv.Atoi(r.URL.Query().Get("limit"))
	if err != nil || limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := a.db.Query(`SELECT l.id, COALESCE(u.name, 'System'), l.action, l.resource_type, l.resource_id, l.details, l.created_at
		FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id ORDER BY l.seq DESC LIMIT ?`, limit)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	out := []AuditEntry{}
	for rows.Next() {
		var e AuditEntry
		var details string
		var ts int64
		if err := rows.Scan(&e.ID, &e.ActorName, &e.Action, &e.ResourceType, &e.ResourceID, &details, &ts); err != nil {
			serverError(w, err)
			return
		}
		_ = json.Unmarshal([]byte(details), &e.Details)
		e.CreatedAt = formatTS(ts)
		out = append(out, e)
	}
	writeJSON(w, 200, out)
}
