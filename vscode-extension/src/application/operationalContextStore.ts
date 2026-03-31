import type { OperationalContextEnvelope } from "../domain/operationalContext";

export interface OperationalContextStorePort {
  getLast(): OperationalContextEnvelope | null;
  setLast(envelope: OperationalContextEnvelope): void;
  clear(): void;
}

export class InMemoryOperationalContextStore implements OperationalContextStorePort {
  private lastEnvelope: OperationalContextEnvelope | null = null;

  public getLast(): OperationalContextEnvelope | null {
    return this.lastEnvelope;
  }

  public setLast(envelope: OperationalContextEnvelope): void {
    this.lastEnvelope = envelope;
  }

  public clear(): void {
    this.lastEnvelope = null;
  }
}
