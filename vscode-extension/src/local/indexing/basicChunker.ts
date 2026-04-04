import { FileHasher } from "./fileHasher";
import type { ChunkRecord } from "../ports";

export interface BasicChunkerConfig {
  chunkSizeChars: number;
  chunkOverlapChars: number;
}

export class BasicChunker {
  constructor(private readonly config: BasicChunkerConfig) {}

  public chunk(content: string): ChunkRecord[] {
    if (!content.trim()) {
      return [];
    }

    const { chunkSizeChars, chunkOverlapChars } = this.config;
    const chunks: ChunkRecord[] = [];
    const step = Math.max(1, chunkSizeChars - chunkOverlapChars);

    let start = 0;
    let chunkIndex = 0;

    while (start < content.length) {
      const end = Math.min(content.length, start + chunkSizeChars);
      const slice = content.slice(start, end);
      chunks.push({
        chunkIndex,
        content: slice,
        contentHash: FileHasher.sha256FromText(slice),
      });

      if (end >= content.length) {
        break;
      }

      chunkIndex += 1;
      start += step;
    }

    return chunks;
  }
}
