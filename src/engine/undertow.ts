/**
 * THE UNDERTOW — the continuous mathematics under the discrete world.
 * Deterministic. Zero tokens. Validated against ground truth in verify §6.
 *
 * Three coupled layers:
 *
 * 1. STRATEGY — logit Quantal Response Equilibrium (McKelvey & Palfrey 1995).
 *    Each driven NPC plays a 4-action stance game {press, maneuver, hold, yield}
 *    against their sharpest rival. Mixed strategies solve the logit fixed point
 *      p_i(a) ∝ exp(λ_i · E_{p_-i} u_i(a, ·)),
 *    where rationality λ_i comes from the clench model: clenched minds are
 *    noisier AND fear-amplify threat payoffs (their equilibrium is genuinely
 *    different, not just blurred). Existence by Brouwer; we damp the iteration.
 *
 * 2. CHAOS — the social fabric as a frustrated Kuramoto network
 *      θ_i' = θ_i + h[ω_i + Σ_j K_ij sin(θ_j − θ_i − α_ij)],
 *    K_ij from |edge| strength, frustration α_ij = π on hostile edges (enemies
 *    anti-phase, allies lock). Coherence R = |Σe^{iθ}|/N. The largest Lyapunov
 *    exponent of this map is estimated by the Benettin tangent method on the
 *    ANALYTIC Jacobian — λ̂ > 0: perturbations grow, the world is primed and
 *    small acts cascade; λ̂ < 0: the world absorbs shocks. We also track the
 *    canonical early-warning statistics of critical transitions (Scheffer et
 *    al., Nature 2009): rising variance and lag-1 autocorrelation = critical
 *    slowing down before a regime shift.
 *
 * 3. CATASTROPHE — psyche on a cusp manifold (Thom; Zeeman's mood models).
 *    Composure x flows on V(x) = x⁴/4 + a·x²/2 + b·x:  ẋ = −(x³ + a x + b),
 *    a = −accumulated load (a < 0 splits the manifold bistable),
 *    b = net social input this turn. Bistability iff Δ = −4a³ − 27b² > 0.
 *    Breaks are FOLD CROSSINGS — sudden jumps with structural hysteresis: the
 *    return path requires b to cross the OPPOSITE fold, so recovery is harder
 *    than collapse by geometry, not by tuning.
 */
import type { Psyche, SaveState } from "./types";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const TAU = Math.PI * 2;

// ───────────────────────── 1. QUANTAL RESPONSE EQUILIBRIUM ─────────────────────────

export const STANCES = ["press", "maneuver", "hold", "yield"] as const;
export type Stance = (typeof STANCES)[number];

function softmax(xs: number[], lambda: number): number[] {
  const m = Math.max(...xs);
  const es = xs.map((x) => Math.exp(lambda * (x - m)));
  const s = es.reduce((a, b) => a + b, 0);
  return es.map((e) => e / s);
}

/**
 * Logit QRE of a bimatrix game (A = row payoffs m×n, B = column payoffs m×n),
 * by damped fixed-point iteration. Returns mixed strategies (p over rows, q over cols).
 */
function qreInner(
  A: number[][], B: number[][], lr: number, lc: number,
  p0: number[], q0: number[], iters: number, tol: number,
): { p: number[]; q: number[]; iterations: number; residual: number } {
  const n = A[0].length;
  let p = [...p0], q = [...q0];
  let residual = Infinity, it = 0;
  for (; it < iters; it++) {
    const gamma = Math.max(0.04, 0.5 / (1 + 0.01 * it));   // annealed damping (Robbins–Monro flavored)
    const up = A.map((row) => row.reduce((s, v, j) => s + v * q[j], 0));
    const uq = Array.from({ length: n }, (_, j) => B.reduce((s, row, i) => s + row[j] * p[i], 0));
    const pHat = softmax(up, lr);
    const qHat = softmax(uq, lc);
    residual = Math.max(
      ...pHat.map((v, i) => Math.abs(v - p[i])),
      ...qHat.map((v, j) => Math.abs(v - q[j])),
    );
    p = p.map((v, i) => (1 - gamma) * v + gamma * pHat[i]);
    q = q.map((v, j) => (1 - gamma) * v + gamma * qHat[j]);
    if (residual < tol) break;
  }
  return { p, q, iterations: it, residual };
}

/**
 * Logit QRE by homotopy path-following: trace the principal branch from λ≈0
 * (where the unique QRE is uniform and the map is a strong contraction) up to
 * the target λ in geometric steps, warm-starting each stage. This is the
 * standard computational approach (Turocy 2005) and tames the oscillation the
 * raw fixed-point iteration exhibits at high rationality.
 */
export function solveQRE(
  A: number[][], B: number[][], lambdaRow: number, lambdaCol: number,
  iters = 600, _gamma = 0, tol = 1e-9,
): { p: number[]; q: number[]; iterations: number; residual: number } {
  const m = A.length, n = A[0].length;
  let p = Array(m).fill(1 / m);
  let q = Array(n).fill(1 / n);
  let total = 0; let last = { p, q, iterations: 0, residual: Infinity };
  const STAGES = 8;
  for (let s = 1; s <= STAGES; s++) {
    const f = s / STAGES;
    last = qreInner(A, B, lambdaRow * f, lambdaCol * f, p, q, s === STAGES ? iters * 4 : iters, tol);
    p = last.p; q = last.q; total += last.iterations;
  }
  return { p, q, iterations: total, residual: last.residual };
}

/** Rationality from the clench model: λ ∈ [0.4, 3.2]. Clenched = noisy. */
export function rationality(psyche: Psyche): number {
  return clamp(1.8 + psyche.relaxation * 0.14 - (psyche.state !== "intact" ? 0.6 : 0), 0.4, 3.2);
}

/**
 * Build the stance game for an NPC vs their rival.
 * Payoffs in arbitrary utiles; fear-distortion multiplies threat terms for clenched minds.
 */
export function stanceGame(args: {
  progress: number; blocked: boolean; urgency: number;      // self drive
  warmth: number; rivalPower: number;                       // edge to rival (-100..100), power balance
  selfPsyche: Psyche; rivalPsyche: Psyche;
  lethality: number;                                        // 0..1 world danger
  aggression?: number;                                      // 0.7 slow_burn · 1.0 active · 1.3 hostile
}): { A: number[][]; B: number[][]; lamA: number; lamB: number } {
  const fearA = args.selfPsyche.relaxation < -5 ? 1.8 : 1.0;  // clenched: threats loom larger
  const fearB = args.rivalPsyche.relaxation < -5 ? 1.8 : 1.0;
  const w = args.warmth / 100;                                // -1..1
  const pow = clamp(args.rivalPower / 100, -1, 1);            // >0: rival stronger
  const urg = args.urgency;                                   // 0..1
  const risk = args.lethality;

  // utility components per stance pair (row = self, col = rival)
  const gain = { press: 1.0, maneuver: 0.7, hold: 0.25, yield: 0.0 };
  const exposure = { press: 1.0, maneuver: 0.45, hold: 0.15, yield: 0.05 };
  const aggr = args.aggression ?? 1.0;
  const u = (mine: Stance, theirs: Stance, fear: number, powAdv: number) => {
    const clash = (mine === "press" ? 1 : mine === "maneuver" ? 0.5 : 0) * (theirs === "press" ? 1 : theirs === "maneuver" ? 0.5 : 0);
    const threat = clash * risk * (1 + Math.max(0, powAdv)) * fear;        // being pressed by the stronger hurts
    const coop = ((mine === "yield" ? 0.45 : mine === "hold" ? 0.3 : 0) + (theirs === "yield" ? 0.25 : 0)) * Math.max(0, w); // warmth makes peace comfortable
    const friendCost = mine === "press" ? Math.max(0, w) * 0.5 : 0;        // pressing a friend spends the friendship
    const blockedPenalty = args.blocked && mine === "press" ? 0.5 : 0;
    const g = mine === "press" ? gain.press * aggr : gain[mine];           // the world's aggression dial scales the appetite for force
    return g * (0.6 + urg) - threat - friendCost - blockedPenalty + coop
      + (mine === "maneuver" && args.blocked ? 0.35 : 0);
  };
  const A = STANCES.map((mi) => STANCES.map((th) => u(mi, th, fearA, pow)));
  const B = STANCES.map((mi) => STANCES.map((th) => u(th, mi, fearB, -pow))); // B[i][j]: col player's utility when row plays i, col plays j
  return { A, B, lamA: rationality(args.selfPsyche), lamB: rationality(args.rivalPsyche) };
}

// ───────────────────────── 2. KURAMOTO + BENETTIN LYAPUNOV ─────────────────────────

export interface UndertowState {
  phases: Record<string, number>;       // θ_i per character
  tangent: number[];                    // Benettin tangent vector (aligned to char order)
  lyap_window: number[];                // recent per-turn log-stretch values
  valence_window: number[];             // player valence history for early warnings
  regime: "damped" | "critical" | "cascading";
  coherence: number;                    // Kuramoto order parameter R
  lyapunov: number;                     // windowed λ̂
  early_warning: boolean;               // critical slowing down detected
  stances?: { name: string; stance: Stance; p: number; vs: string }[];
}

export function initUndertow(): UndertowState {
  return { phases: {}, tangent: [], lyap_window: [], valence_window: [], regime: "damped", coherence: 0, lyapunov: -0.2, early_warning: false };
}

/** One Kuramoto step + tangent propagation through the analytic Jacobian. */
export function kuramotoStep(
  theta: number[], omega: number[], K: number[][], alpha: number[][],
  v: number[], h = 0.35,
): { theta: number[]; v: number[]; logStretch: number; R: number } {
  const N = theta.length;
  const next = new Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let j = 0; j < N; j++) if (j !== i) s += K[i][j] * Math.sin(theta[j] - theta[i] - alpha[i][j]);
    next[i] = (theta[i] + h * (omega[i] + s)) % TAU;
  }
  // tangent: v' = J v, J_ij analytic
  const vNext = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    let diag = 1;
    for (let k = 0; k < N; k++) if (k !== i) diag -= h * K[i][k] * Math.cos(theta[k] - theta[i] - alpha[i][k]);
    for (let j = 0; j < N; j++) {
      const Jij = j === i ? diag : h * K[i][j] * Math.cos(theta[j] - theta[i] - alpha[i][j]);
      vNext[i] += Jij * v[j];
    }
  }
  const norm = Math.hypot(...vNext) || 1e-12;
  const logStretch = Math.log(norm);
  const vn = vNext.map((x) => x / norm);
  // order parameter
  let re = 0, im = 0;
  for (const t of next) { re += Math.cos(t); im += Math.sin(t); }
  const R = Math.hypot(re, im) / N;
  return { theta: next, v: vn, logStretch, R };
}

/**
 * Generic Benettin largest-Lyapunov estimator for a 1-D map (used by verify
 * against the logistic map's known λ(r=4)=ln 2 ground truth).
 */
export function lyapunov1D(f: (x: number) => number, df: (x: number) => number, x0: number, n = 20000, burn = 500): number {
  let x = x0, sum = 0;
  for (let i = 0; i < burn; i++) x = f(x);
  for (let i = 0; i < n; i++) { sum += Math.log(Math.abs(df(x)) + 1e-300); x = f(x); }
  return sum / n;
}

/** Lag-1 autocorrelation — the canonical critical-slowing-down indicator. */
export function lag1Autocorr(xs: number[]): number {
  const n = xs.length;
  if (n < 4) return 0;
  const mu = xs.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { den += (xs[i] - mu) ** 2; if (i > 0) num += (xs[i] - mu) * (xs[i - 1] - mu); }
  return den === 0 ? 0 : num / den;
}

export function variance(xs: number[]): number {
  const n = xs.length; if (n < 2) return 0;
  const mu = xs.reduce((a, b) => a + b, 0) / n;
  return xs.reduce((a, b) => a + (b - mu) ** 2, 0) / (n - 1);
}

// ───────────────────────── 3. CUSP CATASTROPHE PSYCHE ─────────────────────────

export interface CuspPoint { x: number; a: number; b: number }

/** Gradient flow ẋ = −(x³ + a x + b), a few Euler steps. Returns fold events. */
export function cuspStep(pt: CuspPoint, steps = 6, h = 0.22): { snapped: "down" | "up" | null } {
  const sheetBefore = pt.x >= 0 ? "upper" : "lower";
  for (let s = 0; s < steps; s++) {
    pt.x += -h * (pt.x ** 3 + pt.a * pt.x + pt.b);
    pt.x = clamp(pt.x, -2.2, 2.2);
  }
  const sheetAfter = pt.x >= 0 ? "upper" : "lower";
  if (sheetBefore === "upper" && sheetAfter === "lower") return { snapped: "down" };
  if (sheetBefore === "lower" && sheetAfter === "upper") return { snapped: "up" };
  return { snapped: null };
}

/** Bistable iff the discriminant of x³+ax+b is positive: Δ = −4a³ − 27b². */
export const cuspBistable = (a: number, b: number): boolean => -4 * a ** 3 - 27 * b ** 2 > 0;

/**
 * Drive one character's psyche on the manifold — CAPACITY IS HOME.
 *
 * The founding rule of the clench model: anxiety is not a ratchet. People have
 * a natural set point (capacity) and they RETURN to it when the world lets
 * them. So:
 *   • Ordinary life is MONOSTABLE (a > 0): one basin, centered exactly on
 *     capacity — the homing term b_home = −(c³ + a·c) places the equilibrium
 *     at x = capacity/8 analytically. Calm turns pull everyone home.
 *   • Load (a < 0) deepens ONLY under genuine sustained battering (broken/
 *     fracturing state, many active burdens, deep clench held across turns) —
 *     and it heals fast in calm: the bistable wedge is earned, never ambient.
 *   • Snaps (fold crossings) therefore remain possible — with their honest
 *     hysteresis — but they are rare events at the end of real arcs, not the
 *     weather.
 */
export function cuspPsyche(p: Psyche, cusp: CuspPoint): "down" | "up" | null {
  const calm = p.relaxation > -4 && p.state === "intact";
  const battering =
    (p.state !== "intact" ? 0.22 : 0) +
    Math.max(0, p.active_states.length - 2) * 0.08 +
    (p.consecutive_clenched >= 2 ? 0.14 : 0);
  // load: heals briskly in calm, deepens only under sustained pressure
  cusp.a = clamp(cusp.a + (calm ? 0.12 : 0.02) - battering, -1.3, 0.45);

  // b = analytic homing toward capacity + a decaying social residual from the
  // simulator's verdict this turn (relaxation moved away from the manifold = push)
  const home = p.capacity / 8;
  const bHome = -(home ** 3 + cusp.a * home);
  const socialPush = clamp((p.relaxation - cusp.x * 8) / 10, -0.8, 0.8);
  cusp.b = clamp(cusp.b * 0.45 + socialPush * 0.5, -0.9, 0.9);

  const bSave = cusp.b;
  cusp.b = clamp(bHome + cusp.b, -1.2, 1.2);
  const { snapped } = cuspStep(cusp, 6, 0.22 + p.recovery * 0.3);  // personal recovery rate = flow speed
  cusp.b = bSave;

  // the manifold writes the psyche
  p.relaxation = clamp(Math.round(cusp.x * 8), -10, 10);
  if (p.relaxation <= -7) p.consecutive_clenched++; else p.consecutive_clenched = 0;
  if (snapped === "down") {
    p.state = p.state === "intact" ? "fracturing" : "broken";
    if (p.state === "broken") p.break_mode = p.break_mode ?? "fractured";
  }
  if (snapped === "up") { p.state = "intact"; p.break_mode = null; }
  // when the wedge has closed (monostable again) and the person is steady, fracture heals
  if (p.state === "fracturing" && cusp.a > 0 && p.relaxation > -3) { p.state = "intact"; p.break_mode = null; }
  if (p.state === "fracturing" && p.consecutive_clenched >= 6) { p.state = "broken"; p.break_mode = p.break_mode ?? "fractured"; }
  p.mood_valence = clamp(Math.round(p.relaxation * 0.8), -10, 10);
  return snapped;
}

// ───────────────────────── THE TICK: all three layers, once per turn ─────────────────────────

export interface UndertowReport {
  regime: UndertowState["regime"];
  lyapunov: number;
  coherence: number;
  early_warning: boolean;
  instability: number;                   // 0..1, feeds the pressure controller
  stances: { name: string; stance: Stance; p: number; vs: string }[];
  snaps: string[];                       // fold-crossing events, humanized
  directive: string;                     // one line for the narrator
}

export function tickUndertow(state: SaveState, rng: () => number = Math.random): UndertowReport {
  const ut: UndertowState = ((state as any).undertow ??= initUndertow());
  const ids = Object.keys(state.characters);
  const N = ids.length;

  // ── chaos layer: build the frustrated network from the live edge graph ──
  for (const id of ids) if (!(id in ut.phases)) ut.phases[id] = rng() * TAU;
  for (const id of Object.keys(ut.phases)) if (!state.characters[id]) delete ut.phases[id];
  const theta = ids.map((id) => ut.phases[id]);
  const omega = ids.map((id) => 0.8 + (state.condition[id]?.psyche.capacity ?? 0) * 0.04 + (hash(id) % 100) / 250);
  const K = ids.map(() => ids.map(() => 0));
  const alpha = ids.map(() => ids.map(() => 0));
  for (const e of state.world.edges) {
    const i = ids.indexOf(e.from), j = ids.indexOf(e.to);
    if (i < 0 || j < 0) continue;
    const strength = (Math.abs(e.warmth) + Math.abs(e.trust)) / 200; // 0..1
    K[j][i] = Math.max(K[j][i], 0.6 * strength);                     // j feels i
    alpha[j][i] = e.warmth < -15 ? Math.PI : 0;                      // hostility = frustration
  }
  if (ut.tangent.length !== N) ut.tangent = Array.from({ length: N }, () => rng() - 0.5);
  const { theta: th2, v, logStretch, R } = kuramotoStep(theta, omega, K, alpha, ut.tangent);
  ids.forEach((id, i) => (ut.phases[id] = th2[i]));
  ut.tangent = v;
  ut.lyap_window.push(logStretch);
  if (ut.lyap_window.length > 24) ut.lyap_window.shift();
  ut.lyapunov = ut.lyap_window.reduce((a, b) => a + b, 0) / ut.lyap_window.length;
  ut.coherence = R;
  ut.regime = ut.lyapunov > 0.06 ? "cascading" : ut.lyapunov > -0.03 ? "critical" : "damped";

  // ── early warnings: critical slowing down in the player's valence series ──
  const val = state.condition["char_player"]?.psyche.mood_valence ?? 0;
  ut.valence_window.push(val);
  if (ut.valence_window.length > 16) ut.valence_window.shift();
  const half = Math.floor(ut.valence_window.length / 2);
  const ar1Late = lag1Autocorr(ut.valence_window.slice(half));
  const ar1Early = lag1Autocorr(ut.valence_window.slice(0, half));
  const varLate = variance(ut.valence_window.slice(half));
  const varEarly = variance(ut.valence_window.slice(0, half));
  ut.early_warning = ut.valence_window.length >= 12 && ar1Late > ar1Early + 0.15 && varLate > varEarly * 1.3;

  // ── catastrophe layer: every psyche moves on its manifold ──
  const cusps: Record<string, CuspPoint> = ((state as any).undertow.cusps ??= {});
  const snaps: string[] = [];
  for (const id of ids) {
    const p = state.condition[id]?.psyche; if (!p) continue;
    const c = (cusps[id] ??= { x: clamp((p.capacity || p.relaxation) / 8, -2, 2), a: 0.3, b: 0 });
    const snapped = cuspPsyche(p, c);
    if (snapped === "down") snaps.push(`${state.characters[id].name} crossed a fold — something gave way.`);
    if (snapped === "up") snaps.push(`${state.characters[id].name} came back over the fold — steadier ground.`);
  }

  // ── strategy layer: QRE stances for every driven offscreen character ──
  const stances: UndertowReport["stances"] = [];
  const lethality = { low: 0.25, medium: 0.55, high: 0.9 }[state.world_bible.difficulty_profile.lethality];
  for (const id of ids) {
    const c = state.characters[id];
    if (id === "char_player" || !c.drive || state.world.present.includes(id)) continue;
    // sharpest rival: most negative warmth edge from this character
    let rival = ids.find((x) => x !== id) ?? id;
    let worst = Infinity;
    for (const e of state.world.edges) {
      if (e.from === id && e.warmth < worst && e.to !== id) { worst = e.warmth; rival = e.to; }
    }
    const edge = state.world.edges.find((e) => e.from === id && e.to === rival);
    const clockUrg = Math.max(0, ...state.world.clocks.filter((k) => k.status === "running").map((k) => k.filled / k.segments));
    const aggression = { slow_burn: 0.7, active: 1.0, hostile: 1.3 }[state.world_bible.difficulty_profile.antagonist_aggression];
    const { A, B, lamA, lamB } = stanceGame({
      progress: c.drive.progress / 100, blocked: !!c.drive.blocker,
      urgency: clamp(0.3 + c.drive.progress / 200 + clockUrg * 0.4, 0, 1),
      warmth: edge?.warmth ?? 0, rivalPower: edge?.power ?? 0,
      selfPsyche: state.condition[id].psyche,
      rivalPsyche: state.condition[rival]?.psyche ?? state.condition[id].psyche,
      lethality, aggression,
    });
    const { p } = solveQRE(A, B, lamA, lamB);
    // sample the stance from the equilibrium mixture
    let r = rng(), k = 0;
    while (k < p.length - 1 && r > p[k]) { r -= p[k]; k++; }
    const stance = STANCES[k];
    stances.push({ name: c.name, stance, p: p[k], vs: state.characters[rival]?.name ?? "the world" });
    // the stance MOVES the drive — strategy replaces dice
    if (stance === "press") { c.drive.progress = clamp(c.drive.progress + 11 + Math.floor(rng() * 6), 0, 100); }
    else if (stance === "maneuver") {
      c.drive.progress = clamp(c.drive.progress + 7 + Math.floor(rng() * 4), 0, 100);
      if (c.drive.blocker && rng() < 0.4) c.drive.blocker = undefined;
    } else if (stance === "hold") { c.drive.progress = clamp(c.drive.progress + 2, 0, 100); }
    else { /* yield */ if (edge) edge.warmth = clamp(edge.warmth + 4, -100, 100); if (c.drive.blocker && rng() < 0.25) c.drive.blocker = undefined; }
    c.drive.updated_turn = state.world.current_turn;
  }
  ut.stances = stances;

  const instability = ut.regime === "cascading" ? 0.8 : ut.regime === "critical" ? 0.15 : 0;
  const stanceLine = stances.slice(0, 3).map((s) => `${s.name} is ${s.stance}ing (vs ${s.vs})`).join("; ");
  const directive =
    `UNDERTOW: the world is ${ut.regime} (λ̂=${ut.lyapunov.toFixed(2)}, coherence R=${ut.coherence.toFixed(2)})` +
    (ut.regime === "cascading" ? " — primed: small acts cascade, bystanders take sides, sparks catch." :
      ut.regime === "critical" ? " — taut: outcomes can swing either way." :
        " — damped: the world absorbs shocks today; people default to ease, humor, and ordinary kindness. Let scenes breathe.") +
    (ut.early_warning ? " NOTE: the player's inner weather is winding tight — favor continuity and steadiness over fresh pressure." : "") +
    (stanceLine ? ` Offscreen postures: ${stanceLine}.` : "");

  return { regime: ut.regime, lyapunov: ut.lyapunov, coherence: ut.coherence, early_warning: ut.early_warning, instability, stances, snaps, directive };
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
