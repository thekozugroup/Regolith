export function exponentialBackoff(
  attempt: number,
  baseMs: number,
  maxMs: number,
): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  return Math.min(maxMs, baseMs * 2 ** safeAttempt);
}

export function cameraRetryDelay(attempt: number): number {
  return exponentialBackoff(attempt, 1500, 30_000);
}

export function moonrakerReconnectDelay(attempt: number): number {
  return exponentialBackoff(attempt, 2000, 30_000);
}

export function isActiveWebSocketState(readyState: number | undefined): boolean {
  return readyState === 0 || readyState === 1;
}
