export function encodeCursor(offset: number): string {
  return btoa(String(offset));
}

export function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;

  try {
    const offset = Number(atob(cursor));
    return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  } catch {
    return 0;
  }
}
