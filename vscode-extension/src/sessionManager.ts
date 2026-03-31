import * as vscode from "vscode";
import { randomUUID } from "crypto";
import {
  FIXED_CONSUMER,
  SESSION_CREATED_AT_STORAGE_KEY,
  SESSION_KEY_STORAGE_KEY,
} from "./constants";

export type SessionState = "created" | "reused" | "reset";

export interface SessionSnapshot {
  sessionKey: string;
  sessionCreatedAt: string;
  sessionState: SessionState;
}

export class SessionManager {
  constructor(private readonly context: vscode.ExtensionContext) {}

  get consumer(): string {
    return FIXED_CONSUMER;
  }

  public async getOrCreateSession(): Promise<SessionSnapshot> {
    const existing = this.context.workspaceState.get<string>(SESSION_KEY_STORAGE_KEY);
    const existingCreatedAt = this.context.workspaceState.get<string>(SESSION_CREATED_AT_STORAGE_KEY);
    if (existing) {
      const sessionCreatedAt = existingCreatedAt ?? new Date().toISOString();
      if (!existingCreatedAt) {
        await this.context.workspaceState.update(SESSION_CREATED_AT_STORAGE_KEY, sessionCreatedAt);
      }
      return {
        sessionKey: existing,
        sessionCreatedAt,
        sessionState: "reused",
      };
    }
    return this.createSession("created");
  }

  public async resetSession(): Promise<SessionSnapshot> {
    return this.createSession("reset");
  }

  private async createSession(sessionState: "created" | "reset"): Promise<SessionSnapshot> {
    const value = `wis-vscode-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const sessionCreatedAt = new Date().toISOString();
    await this.context.workspaceState.update(SESSION_KEY_STORAGE_KEY, value);
    await this.context.workspaceState.update(SESSION_CREATED_AT_STORAGE_KEY, sessionCreatedAt);
    return {
      sessionKey: value,
      sessionCreatedAt,
      sessionState,
    };
  }
}
