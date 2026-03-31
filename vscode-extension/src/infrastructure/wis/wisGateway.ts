import type { RuntimeMode, ScopePayload, ToolResult, WISBundleResult } from "../../domain/operationalContext";

export type AuthMode = "none" | "bearer" | "api_key";

export interface ResolvedAuthConfig {
  mode: AuthMode;
  header_name: string;
  required: boolean;
}

export interface AuthRuntimeContext extends ResolvedAuthConfig {
  token: string | null;
}

export interface WISLoadInput {
  endpoint: string;
  runtime_mode: RuntimeMode;
  timeout_ms: number;
  consumer: string;
  session_key: string;
  scope?: Partial<ScopePayload>;
  auth?: AuthRuntimeContext;
}

export interface WISGateway {
  getActiveTask(input: WISLoadInput): Promise<ToolResult>;
  getContextSnapshot(input: WISLoadInput): Promise<ToolResult>;
  getValidationStatus(input: WISLoadInput): Promise<ToolResult>;
  getApprovedDecisions(input: WISLoadInput): Promise<ToolResult>;
  getRecentErrors(input: WISLoadInput): Promise<ToolResult>;
  loadOperationalBundle(input: WISLoadInput): Promise<WISBundleResult>;
}
