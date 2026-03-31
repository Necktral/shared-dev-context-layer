import type { OperationalContextEnvelope } from "../domain/operationalContext";
import type { LoadEvent } from "./loadEvents";

export function formatLoadEvent(event: LoadEvent): string {
  return `[WIS] ${event.event} state=${event.state} at=${event.timestamp} details=${JSON.stringify(event.details)}`;
}

export function formatOperationalEnvelopeEnvelopeLine(envelope: OperationalContextEnvelope): string {
  return (
    `[WIS] envelope consumer=${envelope.meta.consumer}` +
    ` session_key=${envelope.meta.session_key}` +
    ` endpoint=${envelope.meta.endpoint}` +
    ` runtime_mode=${envelope.meta.runtime_mode}` +
    ` transport_status=${envelope.meta.transport_status}` +
    ` load_state=${envelope.meta.load_state}` +
    ` issues=${envelope.issues.length}`
  );
}
