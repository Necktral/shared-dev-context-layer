import type { LoadState } from "../domain/loadState";

export interface LoadEvent {
  event: string;
  state: LoadState | "preparing" | "inspecting_local" | "loading_remote";
  timestamp: string;
  details: Record<string, unknown>;
}
