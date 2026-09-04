/** 콘텐츠 변경 감지용 결정적 64비트 FNV-1a 해시. 보안 용도가 아니다. */
export function contentHash(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}
