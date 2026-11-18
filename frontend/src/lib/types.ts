// Mirrors docs/api-contract.md. Money is integer paise; times are ISO strings in IST.

export type Role = "driver" | "owner" | "admin";
export type Connector = "CCS2" | "TYPE2" | "CHADEMO" | "GBT";
export type Mode = "AC" | "DC";
export type AvailabilitySource = "live" | "schedule" | "reported" | "stale" | "unknown";
export type Compatibility = "compatible" | "incompatible" | "unknown";
export type BookingStatus = "requested" | "accepted" | "confirmed" | "in_progress" | "completed" | "rejected" | "cancelled" | "expired";

export interface User {
  id: string;
  name: string;
  email: string;
  roles: Role[];
}

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  category: string;
  connectors: Connector[];
  max_ac_kw: number;
  max_dc_kw: number;
  battery_kwh: number;
}

export interface Availability {
  source: AvailabilitySource;
  last_updated_at: string;
  label: string;
}

export interface ChargerSummary {
  id: string;
  name: string;
  category: "private" | "business" | "public";
  lat: number;
  lng: number;
  approx_area: string;
  distance_km: number | null;
  connector: Connector;
  mode: Mode;
  power_kw: number;
  effective_power_kw: number | null;
  price_per_kwh_paise: number;
  bookable: boolean;
  availability: Availability;
  compatibility: Compatibility;
  compatibility_reason: string;
  rating: number;
  review_count: number;
}

export interface ScheduleRule {
  weekday: number;
  start_time: string;
  end_time: string;
}

export interface ChargerDetail extends ChargerSummary {
  description: string;
  owner_name: string | null;
  amenities: string[];
  photo_url: string | null;
  status: "approved" | "submitted" | "rejected" | "paused";
  address: string | null;
  access_instructions: string | null;
  schedule: ScheduleRule[];
  review_note?: string;
}

export interface PriceBreakdown {
  energy_kwh: number;
  energy_cost_paise: number;
  service_fee_paise: number;
  tax_paise: number;
  total_paise: number;
  assumptions: string[];
}

export interface Slot {
  start_at: string;
  end_at: string;
  available: boolean;
}

export interface BookingEvent {
  event_type: string;
  actor_id: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

export interface Booking {
  id: string;
  status: BookingStatus;
  charger: { id: string; name: string; approx_area?: string };
  driver: { id: string; name: string };
  vehicle_id: string;
  start_at: string;
  end_at: string;
  price: PriceBreakdown;
  payment_status: "none" | "paid" | "refunded";
  address: string | null;
  access_instructions: string | null;
  events: BookingEvent[];
  created_at: string;
  expires_at: string | null;
  reviewed: boolean;
  has_open_issue: boolean;
}

export interface ToolTrace {
  tool: string;
  ok: boolean;
  summary: string;
}

export interface PendingAction {
  type: "booking";
  confirmation_id: string;
  expires_at: string;
  summary: {
    charger_id: string;
    charger_name: string;
    approx_area: string;
    vehicle: string;
    start_at: string;
    end_at: string;
    price: PriceBreakdown;
    cancellation_policy: string;
  };
}

export interface AgentResponse {
  reply: string;
  history_content: string;
  mode: "ai" | "offline";
  tool_trace: ToolTrace[];
  cards: ChargerSummary[];
  pending_action: PendingAction | null;
}

export interface RiskFlag {
  target_type: "charger" | "user";
  target_id: string;
  target_label: string;
  score: number;
  signals: string[];
}

export interface Report {
  id: string;
  reporter_name: string;
  target_type: string;
  target_id: string;
  target_label: string;
  category: string;
  reason: string;
  status: "open" | "resolved";
  resolution: string;
  created_at: string;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  read: boolean;
  created_at: string;
}

export interface AuditEntry {
  id: string;
  actor_name: string;
  action: string;
  resource_type: string;
  resource_id: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface RoutePlan {
  distance_km: number;
  duration_min: number;
  polyline: [number, number][];
  estimated_range_km: number | null;
  needs_charge: boolean | null;
  suggested_stops: ChargerSummary[];
  assumptions: string[];
  source: "osrm" | "estimate";
}

export interface Payout {
  id: string;
  booking_id: string;
  charger_name: string;
  amount_paise: number;
  status: "pending" | "paid";
  created_at: string;
}

export interface Review {
  rating: number;
  comment: string;
  author_name: string;
  created_at: string;
}

export interface PaymentOrder {
  provider: "razorpay" | "mock";
  order_id: string;
  key_id?: string;
  amount_paise: number;
  currency: string;
  name: string;
  description: string;
}
