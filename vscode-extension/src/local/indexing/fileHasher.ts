import { createHash } from "node:crypto";

export class FileHasher {
  public static sha256FromBuffer(content: Buffer): string {
    return createHash("sha256").update(content).digest("hex");
  }

  public static sha256FromText(content: string): string {
    return createHash("sha256").update(content, "utf8").digest("hex");
  }
}
