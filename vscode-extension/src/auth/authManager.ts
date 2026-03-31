import * as vscode from "vscode";
import { getAuthConfig } from "../config";
import { AUTH_TOKEN_STORAGE_KEY } from "../constants";
import type { AuthRuntimeContext } from "../infrastructure/wis/wisGateway";

export interface AuthStatusSnapshot extends AuthRuntimeContext {
  has_token: boolean;
}

export class AuthManager {
  constructor(private readonly context: vscode.ExtensionContext) {}

  public async resolveAuthContext(): Promise<AuthRuntimeContext> {
    const config = getAuthConfig();
    const token = await this.context.secrets.get(AUTH_TOKEN_STORAGE_KEY);
    return {
      mode: config.mode,
      header_name: config.header_name,
      required: config.required,
      token: token?.trim() ? token.trim() : null,
    };
  }

  public async status(): Promise<AuthStatusSnapshot> {
    const resolved = await this.resolveAuthContext();
    return {
      ...resolved,
      has_token: Boolean(resolved.token),
    };
  }

  public async configureInteractive(): Promise<AuthStatusSnapshot> {
    const resolved = await this.resolveAuthContext();
    if (resolved.mode === "none") {
      return {
        ...resolved,
        has_token: Boolean(resolved.token),
      };
    }

    const token = await vscode.window.showInputBox({
      title: "WIS Context Sync - Authentication",
      prompt: resolved.mode === "bearer" ? "Ingresa Bearer token" : `Ingresa token para header ${resolved.header_name}`,
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value.trim()) {
          return "El token no puede estar vacío.";
        }
        return undefined;
      },
    });

    if (!token) {
      return {
        ...resolved,
        has_token: Boolean(resolved.token),
      };
    }

    await this.context.secrets.store(AUTH_TOKEN_STORAGE_KEY, token.trim());
    const next = await this.resolveAuthContext();
    return {
      ...next,
      has_token: Boolean(next.token),
    };
  }

  public async clearToken(): Promise<void> {
    await this.context.secrets.delete(AUTH_TOKEN_STORAGE_KEY);
  }
}
