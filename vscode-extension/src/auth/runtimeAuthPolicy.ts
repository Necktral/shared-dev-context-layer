import type { AuthRuntimeContext } from "../infrastructure/wis/wisGateway";

export type RuntimeAuthMode = "none" | "bearer" | "api_key";

export interface RuntimeAuthContext {
  mode: RuntimeAuthMode;
  token: string | null;
  required: boolean;
  header_name?: string | null;
}

export type RuntimeAuthDecisionCode =
  | "ok"
  | "missing_token"
  | "mode_none_but_required"
  | "invalid_header_name"
  | "token_present_in_none_mode";

export interface RuntimeAuthDecision {
  allowed: boolean;
  code: RuntimeAuthDecisionCode;
  message: string;
}

export class RuntimeAuthPolicy {
  public evaluate(context: RuntimeAuthContext): RuntimeAuthDecision {
    if (context.mode === "none") {
      if (context.required) {
        return {
          allowed: false,
          code: "mode_none_but_required",
          message: "auth.required=true no permite authMode=none.",
        };
      }

      if (context.token) {
        return {
          allowed: false,
          code: "token_present_in_none_mode",
          message: "Existe token configurado pero authMode=none.",
        };
      }

      return {
        allowed: true,
        code: "ok",
        message: "Modo none válido.",
      };
    }

    if (!context.token || !context.token.trim()) {
      return {
        allowed: false,
        code: "missing_token",
        message: `Falta token para authMode=${context.mode}.`,
      };
    }

    if (context.mode === "api_key") {
      const headerName = context.header_name?.trim() ?? "";
      if (!headerName) {
        return {
          allowed: false,
          code: "invalid_header_name",
          message: "api_key requiere headerName no vacío.",
        };
      }
    }

    return {
      allowed: true,
      code: "ok",
      message: "Configuración auth válida.",
    };
  }

  public fromAuthRuntimeContext(auth: AuthRuntimeContext): RuntimeAuthContext {
    return {
      mode: auth.mode,
      token: auth.token,
      required: auth.required,
      header_name: auth.header_name,
    };
  }
}
