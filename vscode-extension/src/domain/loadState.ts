export type TransportStatus =
  | "ok"
  | "partial"
  | "degraded"
  | "transport_error"
  | "schema_error"
  | "unavailable";

export type LoadState =
  | "idle"
  | "preparing"
  | "inspecting_local"
  | "connecting_wis"
  | "loading_remote"
  | "composing"
  | "presenting"
  | "loaded"
  | "partially_loaded"
  | "degraded"
  | "failed";
