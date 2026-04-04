export class TextFileDetector {
  public static isLikelyText(content: Buffer): boolean {
    if (content.length === 0) {
      return true;
    }

    let suspicious = 0;
    const sampleSize = Math.min(content.length, 4096);
    for (let index = 0; index < sampleSize; index += 1) {
      const byte = content[index];
      if (byte === 0) {
        return false;
      }
      const isCommonControl = byte === 9 || byte === 10 || byte === 13;
      const isPrintable = byte >= 32 && byte <= 126;
      const isExtended = byte >= 128;
      if (!isCommonControl && !isPrintable && !isExtended) {
        suspicious += 1;
      }
    }

    return suspicious / sampleSize < 0.1;
  }
}
