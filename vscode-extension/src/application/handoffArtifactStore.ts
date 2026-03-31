import type { HandoffArtifact, HandoffBuildResult } from "../domain/handoff";

export interface HandoffArtifactStorePort {
  getLastArtifact(): HandoffArtifact | null;
  getLastResult(): HandoffBuildResult | null;
  setLastResult(result: HandoffBuildResult): void;
  clear(): void;
}

export class InMemoryHandoffArtifactStore implements HandoffArtifactStorePort {
  private lastArtifact: HandoffArtifact | null = null;
  private lastResult: HandoffBuildResult | null = null;

  public getLastArtifact(): HandoffArtifact | null {
    return this.lastArtifact;
  }

  public getLastResult(): HandoffBuildResult | null {
    return this.lastResult;
  }

  public setLastResult(result: HandoffBuildResult): void {
    this.lastResult = result;
    this.lastArtifact = result.artifact;
  }

  public clear(): void {
    this.lastArtifact = null;
    this.lastResult = null;
  }
}
