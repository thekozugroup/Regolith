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

/**
 * Spread a backoff delay over the second half of its window.
 *
 * Without this every client that lost the same printer retries at the same
 * instant forever: reboot a K1 Max with the panel, a laptop and two phones
 * watching and all four reconnect in lockstep, hammering Moonraker in
 * synchronized bursts exactly while it is slowest. "Equal jitter" rather than
 * full jitter, so the delay keeps a floor of half the base — a reconnect must
 * still actually back off, not collapse to near-zero on an unlucky draw.
 *
 * `random` is a parameter so the behaviour is testable rather than sampled.
 */
export function jitteredDelay(baseMs: number, random: number): number {
  const base = Number.isFinite(baseMs) && baseMs > 0 ? baseMs : 0;
  const spread = Math.min(Math.max(random, 0), 1);
  return Math.round(base / 2 + spread * (base / 2));
}

export function isActiveWebSocketState(readyState: number | undefined): boolean {
  return readyState === 0 || readyState === 1;
}
