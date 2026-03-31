import type { RuntimeMode, ScopePayload, ToolResult, WISBundleResult } from "../../domain/operationalContext";

export interface WISLoadInput {
  endpoint: string;
  runtime_mode: RuntimeMode;
  timeout_ms: number;
  consumer: string;
  session_key: string;
  scope?: Partial<ScopePayload>;
}

export interface WISGateway {
  getActiveTask(input: WISLoadInput): Promise<ToolResult>;
  getContextSnapshot(input: WISLoadInput): Promise<ToolResult>;
  getValidationStatus(input: WISLoadInput): Promise<ToolResult>;
  getApprovedDecisions(input: WISLoadInput): Promise<ToolResult>;
  getRecentErrors(input: WISLoadInput): Promise<ToolResult>;
  loadOperationalBundle(input: WISLoadInput): Promise<WISBundleResult>;
}
