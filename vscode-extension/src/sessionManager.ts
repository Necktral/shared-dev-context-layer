import * as vscode from "vscode";
import { randomUUID } from "crypto";
import {
  FIXED_CONSUMER,
  SESSION_CREATED_AT_STORAGE_KEY,
  SESSION_KEY_STORAGE_KEY,
} from "./constants";

export class SessionManager {
  constructor(private readonly context: vscode.ExtensionContext) {}

  get consumer(): string {
    return FIXED_CONSUMER;
  }

  public async getSessionKey(): Promise<string> {
    const existing = this.context.workspaceState.get<string>(SESSION_KEY_STORAGE_KEY);
    if (existing) {
      return existing;
    }
    return this.rotateSessionKey();
  }

  public async rotateSessionKey(): Promise<string> {
    const value = `wis-vscode-${Date.now()}-${randomUUID().slice(0, 8)}`;
    await this.context.workspaceState.update(SESSION_KEY_STORAGE_KEY, value);
    await this.context.workspaceState.update(SESSION_CREATED_AT_STORAGE_KEY, new Date().toISOString());
    return value;
  }

  public getSessionCreatedAt(): string | undefined {
    return this.context.workspaceState.get<string>(SESSION_CREATED_AT_STORAGE_KEY);
  }
}
