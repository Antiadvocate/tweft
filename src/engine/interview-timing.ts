/**
 * WEFT-INTERVIEW — timing + the password gate.
 *
 * Timing measures pressure-handling, not typing speed. We separate:
 *   - LATENCY: message shown → first keystroke. Pausing here is HEALTHY under
 *     tension (the candidate took a breath before reacting) — a positive signal.
 *   - TYPING: first keystroke → submit. Compared to a length-adjusted, configurable
 *     baseline so a thoughtful long answer isn't mislabeled "slow".
 * The output is descriptive (on pace / faster / slower; paused or fired back),
 * surfaced to the reviewer — never a silent score penalty for slow typists.
 */
import type { ResponseTiming, TimeBudget } from "./interview-types";

/** Build a ResponseTiming from raw measurements + the configurable baseline. */
export function computeTiming(args: {
  turn: number;
  text: string;
  incomingWords: number;     // length of the message the candidate is replying to
  latencyMs: number;         // shown → first keystroke
  typingMs: number;          // first keystroke → submit
  budget: TimeBudget;
}): ResponseTiming {
  const { turn, text, incomingWords, latencyMs, typingMs, budget } = args;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const chars = text.length;

  const expected_typing_ms = Math.max(1, (words / Math.max(1, budget.assumed_wpm)) * 60_000);
  const expected_reading_ms = Math.max(1, (incomingWords / Math.max(1, budget.reading_wpm)) * 60_000);
  const total_ms = latencyMs + typingMs;

  const denom = expected_reading_ms + expected_typing_ms;
  const pace_vs_expected = denom > 0 ? total_ms / denom : 1;

  // "took a breath": latency notably exceeded the time it'd take to merely read the message.
  const paused_before_typing = latencyMs > expected_reading_ms * 1.4;

  return {
    turn, chars, words,
    latency_ms: Math.round(latencyMs),
    typing_ms: Math.round(typingMs),
    total_ms: Math.round(total_ms),
    expected_typing_ms: Math.round(expected_typing_ms),
    expected_reading_ms: Math.round(expected_reading_ms),
    pace_vs_expected: Math.round(pace_vs_expected * 100) / 100,
    paused_before_typing,
  };
}

/** Plain-language summary of the whole run's pacing, for the reviewer and the grader. */
export function summarizeTiming(timings: ResponseTiming[]): string {
  if (!timings.length) return "No timed responses.";
  const avgPace = timings.reduce((a, t) => a + t.pace_vs_expected, 0) / timings.length;
  const paused = timings.filter((t) => t.paused_before_typing).length;
  const fast = timings.filter((t) => t.pace_vs_expected < 0.7).length;
  const pacing = avgPace < 0.75 ? "consistently fast — fired back quickly"
    : avgPace > 1.4 ? "deliberate — took time over responses"
    : "roughly on a natural pace";
  return `Responses were ${pacing} (avg pace ${avgPace.toFixed(2)}× the length-adjusted expectation). `
    + `Paused to think before typing on ${paused} of ${timings.length} responses; `
    + `${fast} response(s) came back notably fast.`;
}

/** Whether the locked clock has expired. The run ends at this boundary, no bypass. */
export function clockExpired(startedAtMs: number | null, budget: TimeBudget, nowMs = Date.now()): boolean {
  if (startedAtMs == null) return false;        // clock hasn't started (no first response yet)
  return nowMs - startedAtMs >= budget.total_seconds * 1000;
}

export function secondsRemaining(startedAtMs: number | null, budget: TimeBudget, nowMs = Date.now()): number {
  if (startedAtMs == null) return budget.total_seconds;
  return Math.max(0, Math.round(budget.total_seconds - (nowMs - startedAtMs) / 1000));
}

// ───────────────────────────── password gate (Web Crypto) ─────────────────────────────

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomSalt(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hash a reviewer password with a fresh salt. Plaintext is never stored. */
export async function makeScopePassword(password: string): Promise<{ password_hash: string; password_salt: string }> {
  const salt = randomSalt();
  const data = new TextEncoder().encode(salt + ":" + password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return { password_hash: toHex(digest), password_salt: salt };
}

/** Verify a password attempt against the stored salted hash. */
export async function verifyScopePassword(password: string, hash: string, salt: string): Promise<boolean> {
  const data = new TextEncoder().encode(salt + ":" + password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest) === hash;
}
