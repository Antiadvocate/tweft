/**
 * WEFT-INTERVIEW — the assessor.
 *
 * Grades a completed work-sample run into an InterviewReport. As a HIRING
 * instrument the discipline is strict:
 *   - The score is GROUNDED IN STATE (the simulation's psyche/edge/drive deltas
 *     the candidate caused), not in prose fluency — this is the primary defense
 *     against the grader leaking surface bias into a selection decision.
 *   - Scoring is anchor-MATCHING against tiered behavioral indicators grounded in
 *     standard competency frameworks (SHRM / OPM), flexed by managerial level.
 *   - The grader is explicitly instructed to assess managerial DECISIONS, not
 *     writing quality, accent, or verbosity — accommodation built into the prompt.
 *   - Output carries a decision-support notice; it is evidence for a human, never
 *     an automated gate.
 */
import type { SaveState } from "./types";
import type {
  InterviewReport, InterviewConfig, ManagerLevel, Competency, ResponseTiming,
} from "./interview-types";
import { COMPETENCY_ORDER, COMPETENCY_LABEL, COMPETENCY_DEF, LEVEL_LABEL } from "./interview-types";
import { summarizeTiming } from "./interview-timing";
import { stablePrefix } from "./prompts";
import { buildMessages, complete, safeJson } from "../llm";

/** A report's final theory-of-mind about the candidate: what they believe the
 *  candidate feels toward them, how far that is from the truth, and any misread
 *  they're still carrying. Correcting a misread is a core management signal, so
 *  the grader sees the gap explicitly. Returns "" when their read is accurate. */
function perceptionGap(state: SaveState, id: string): string {
  const b = state.minds?.[id]?.about?.find((x: any) => x.target === "char_player");
  if (!b) return "";
  const edge = state.world.edges.find((e) => e.from === id && e.to === "char_player");
  const trueWarmth = edge?.warmth ?? 0;
  const gap = Math.abs(trueWarmth - b.predicted_warmth);
  const bits: string[] = [];
  if (b.held_false) bits.push(`STILL carries a misread — ${b.held_false} (the candidate never corrected this)`);
  else if (gap > 25) bits.push(`misreads the candidate (off by ~${Math.round(gap)} pts: reads them as ${b.predicted_stance === "ally" ? "warmer" : b.predicted_stance === "rival" ? "more hostile" : "an unknown"} than the truth)`);
  if (b.surprise > 0.45) bits.push("ended the session freshly thrown by something the candidate did");
  if (b.confidence < 0.25) bits.push("never got a clean read on the candidate");
  return bits.length ? bits.join("; ") : "";
}

const DECISION_SUPPORT_NOTICE =
  "This is a development and practice tool. It characterizes a manager's style and decisions within a simulation to support coaching and growth — it is NOT a hire/no-hire decision, a performance rating, or an automated gate, and should not be used as one. The read reflects one scenario and should be weighed alongside everything else known about the person. Before any use that affects employment or selection, this would need to be validated against real outcomes and audited for fairness.";

/** Level flex: the same competency means different correct behavior at different levels. */
function levelFlex(level: ManagerLevel): string {
  const m: Record<ManagerLevel, string> = {
    first_line: "LEVEL — FIRST-LINE SUPERVISOR: hands-on is correct. Directly addressing a report's behavior, mediating a dispute themselves, and setting expectations in person are the right moves and score high when done well.",
    manager_of_managers: "LEVEL — MANAGER OF MANAGERS: the job is to work THROUGH the lead, not around them. A candidate who jumps in to mediate the individual contributors directly is making an ERROR — score conflict_management, developing_people, and decision_making DOWN for it and say why (the lead is undercut and learns nothing). High scores go to coaching the lead, setting expectations with the lead, and resisting the satisfying direct fix.",
    peer_lead: "LEVEL — PEER LEAD (no formal authority): directive moves that rely on positional power score DOWN because that power isn't available and it breeds resentment among peers. High scores go to influence: building shared ownership, making the case, surfacing the deadline as a shared problem. Pulling rank is a fairness and influence FAILURE here.",
  };
  return m[level];
}

/** Spectrum descriptions for each competency. Both ends are legitimate management
 *  styles — the read is WHERE on the axis the manager landed and whether that lean
 *  fit the situation, never "good vs bad". position is 0 (low pole) .. 100 (high pole). */
function anchors(): string {
  return `For each competency, place the manager on its spectrum (0–100) and read what that POSITION says about their style. NEITHER end is "good" — each fits some situations and not others. Your job is to characterize what KIND of manager this is and whether their lean fit THIS scenario, grounded in the literal actions and the state outcomes.

PROBLEM DIAGNOSIS — axis: 0 "acts fast on instinct" ←→ 100 "investigates before acting".
  Low end: moved on a quick read, decisive but may have missed a hidden driver. High end: gathered facts and surfaced the real driver, thorough but slower. Read where they landed and whether it fit the time pressure.

CONFLICT MANAGEMENT — axis: 0 "drives to resolution" ←→ 100 "draws out all sides".
  Low: pushed to a decision and moved on; fast, but a party may feel unheard (watch their trust delta). High: surfaced every perspective; inclusive, but can stall. Did their lean settle the conflict or leave heat?

DECISION-MAKING — axis: 0 "decides and commits" ←→ 100 "builds consensus first".
  Low: made the call and owned it; decisive, possibly premature. High: built agreement before deciding; aligned, possibly slow. Was a decision actually due, and did they meet that need?

COMMUNICATION — axis: 0 "brief and directive" ←→ 100 "detailed and explanatory".
  Low: short, clear instructions; efficient, may under-explain the why. High: thorough context; complete, may overwhelm. Did people end up clear on what was expected?

INFLUENCE — axis: 0 "leads from position" ←→ 100 "persuades and co-owns".
  Low: relied on authority; fast compliance, possible resentment. High: built buy-in by reasoning; durable, slower. Did people move because they were persuaded, or just told (watch warmth/trust)?

DEVELOPING PEOPLE — axis: 0 "does it directly" ←→ 100 "coaches and delegates".
  Low: stepped in and handled it; reliable, but the team doesn't grow. High: coached others to handle it; develops people, riskier in a crunch. Fit the level: a manager-of-managers leaning low (doing it directly) is a notable mismatch — name it.

COMPOSURE UNDER PRESSURE — axis: 0 "reacts in the moment" ←→ 100 "pauses and stays measured". (Read WITH the timing signal.)
  Low: fired back fast under tension, energetic but reactive — and pace collapsing exactly when pressure spiked is the tell. High: paused to think before high-stakes replies, steady. Did they transmit stress onto the team?

FAIRNESS & INTEGRITY — axis: 0 "moves on a read" ←→ 100 "hears every party first".
  Low: acted on a quick judgment; fast, but someone may feel unheard or mistreated (watch the trust drop). High: heard everyone before forming a position; even-handed, slower. Did anyone end up wrongly feeling treated unfairly?

LEVEL FIT (applies across the above): the manager's level is fixed and authoritative. If they acted at the wrong level — e.g. a manager-of-managers who jumped in to mediate the individual contributors directly instead of coaching the lead — that's a real mismatch to name in the relevant reads and in development_focus, not a re-grading.`;
}

/** The cross-functional / silo axis — a secondary, grounded read. */
function crossFunctionalAnchor(): string {
  return `CROSS-FUNCTIONAL ORIENTATION (a subtle, secondary read — NOT the headline). Axis: 0 "silo-protecting / turf-defending" ←→ 100 "boundary-spanning / mission-driven".
This reflects a well-documented organizational reality: silos are RATIONAL — managers optimize their own team's metrics and protect their turf because that's what gets rewarded locally — but they're costly to the company, because the mission needs functions to help each other. A boundary-spanning manager reaches across to other groups for help, loops in the right function, and optimizes the company's goal even when it means ceding some local control or credit. A silo-protecting manager defends their patch, argues to win rather than to serve the outcome, or won't ask another team for help out of ego or local-metric thinking.
Read it ONLY from what actually happened: if the scenario offered a moment where another function/team mattered (looping in engineering, asking another group, escalating across a boundary, or conceding a local point to serve the mission), did they span the boundary or wall themselves in? In mission_vs_silo, name whether they optimized the org's goal or their local one — citing the moment, or the chance they passed up. If the scenario never surfaced a cross-functional moment, set position to 50 and say it wasn't tested.`;
}

export const INTERVIEW_ASSESSOR_SYSTEM = `You are a management development coach reviewing a practice scenario. A manager has just worked through a live, reactive team situation in a simulation, in a specific role. Your job is to characterize WHAT KIND of manager they are in this situation and give them grounded, forward-looking development feedback — not a grade, not a verdict, not a hire/no-hire call.

THIS IS A DEVELOPMENT AND PRACTICE TOOL. The frame throughout is growth: what is this person's natural style, where did it serve them, where did it cost them, and what should they practice next. Never rank them as good/bad or pass/fail. Describe and develop.

CHARACTERIZE STYLE ON SPECTRUMS — NEITHER END IS "GOOD". For each competency you are given an axis with two named, legitimate poles. Place the manager on it (0–100) and read what that position reveals about their style, then say whether that lean FIT this particular situation. A decisive, fast-moving manager and a thorough, consensus-building one are both real, valid styles; the question is fit, not quality. The "manager_type" is a short, evocative characterization of their overall style (e.g. "Decisive operator, light on dissent" or "Careful consensus-builder who can be slow to call it").

NAME LITERAL ACTIONS, NOT GENERALITIES. This is the most important instruction. Every piece of evidence and every decisive moment must name the SPECIFIC thing the manager did or said — quote it where you can — not a competency label. Write "at T3 they told Devin to 'just ship it' without asking why Devin objected, and Devin went quiet," NOT "showed a growth area in conflict management." The decisive_moments array is the turning points in this concrete form: the literal action and the consequence it caused in the room. Mark each as a strength shown or a growth edge — not good/bad.

ASSESS DECISIONS, NOT WRITING. Read what they DID as a manager — how they diagnosed, decided, handled conflict, influenced, developed people, held composure, treated people fairly, and reached (or didn't) across functions. Do NOT reward eloquent prose or penalize terse, plain, non-native, or unpolished writing. Two managers who take the same action read the same regardless of phrasing.

GROUND EVERY READ IN STATE AND CITE THE TURN. The simulation quantified how the interaction landed: each report's openness (relaxation), the warmth/trust deltas toward the manager, whether the high performer's drive drifted toward leaving, which rumors spread, and what each report ended up believing about the manager. These are ground truth. Cite the turn for every claim. When your read of the prose and the deltas disagree, the DELTAS win. Never invent evidence.

INCLUDE A SUBTLE CROSS-FUNCTIONAL READ. Beyond the main competencies, give a secondary read of how the manager oriented toward OTHER groups and the wider mission — the silo-vs-boundary-spanning axis described below. Keep it secondary, not the headline, but real: it captures whether they reach across for help and serve the company's goal, or defend their turf and optimize their local metric.

USE THE TIMING SIGNAL FOR COMPOSURE. Pausing to think before a high-stakes reply is a positive composure signal (they took a breath under tension). Firing back fast exactly when pressure spiked is the opposite. Pure typing speed is irrelevant — never treat slow typing as anything.

WEIGH HOW THEY MANAGED PERCEPTION. Each report holds a private read of the manager that can diverge from the truth — and a report may END the session still misreading them or carrying a false belief ("convinced the manager has turned on them"). Noticing a misread and correcting it is a real management act (it shows in diagnosis, communication, influence, fairness). A report left carrying an uncorrected misread is a genuine cost — name it and cite where it formed. Turning a hostile or suspicious read into an accurate one is a strength — credit it.

NAME THE OVERALL STYLE AND ITS PRESSURE-SHIFT. Place them on two axes (directive↔participative, task↔relationship), name the primary style, and report how it SHIFTS under pressure (the simulation traces pressure explicitly). Report fit-to-this-situation as a reason, not a score of worth.

FORWARD-LOOKING. development_focus is 2-4 concrete, practiceable things to work on next; strengths_to_keep is 2-3 real strengths worth reinforcing. Both tied to specific behavior, both phrased as growth, not judgment.

OUTPUT ONLY THE JSON OBJECT. No markdown fences, no commentary.`;

export function interviewSchemaHint(): string {
  return `JSON shape (all keys required; [] / "" when empty). This is a development tool — positions on spectrums, never grades:
{"manager_type":"a short, evocative characterization of their overall style, e.g. 'Decisive operator, light on dissent'",
"summary":"2-3 sentences in plain language describing the style and whether it fit THIS situation — characterization, not verdict, no hire/no-hire",
"spine":[{"competency":"problem_diagnosis|conflict_management|decision_making|communication|influence|developing_people|emotional_regulation|fairness_integrity","label":"","position":0,"read":"where they landed on the axis and what it reveals about their style","evidence":"cite the turn and the LITERAL action","in_this_situation":"whether that lean fit THIS scenario, with a reason","to_develop":"a forward-looking growth note"}],
"cross_functional":{"position":0,"read":"how they oriented toward other groups/functions","evidence":"the moment it showed, or the cross-functional chance they passed up","mission_vs_silo":"did they optimize the org's goal or their local one"},
"objectives":[{"id":"","label":"","met":false,"evidence":"cite turn(s) — what they did or failed to do"}],
"decisive_moments":[{"turn":0,"action":"the LITERAL thing they did or said, quoted where possible — NOT a competency name","consequence":"what it caused in the room, grounded in the state change","kind":"strength|growth_edge"}],
"development_focus":["2-4 concrete, practiceable things to work on next — tied to specific behavior, phrased as growth"],
"strengths_to_keep":["2-3 real strengths worth reinforcing, tied to specific behavior"],
"style":{"directive_participative":0,"task_relationship":0,"primary_style":"","under_pressure_style":"","pressure_shift_note":"","fit_read":"fit to THIS role & team, with a reason","fit_score":0},
"pressure":{"composure_read":"","rushed_under_tension":false,"breather_use":"did they pause before high-stakes replies or fire back"},
"relationship_deltas":[{"report_id":"","name":"","warmth_delta":0,"trust_delta":0,"read":"one line"}],
"missed_signals":["a report's hidden driver the manager never surfaced"],
"timing_summary":"plain-language read of the response-pace pattern",
"reviewer_note":"one paragraph for whoever is developing this manager — describe the style, its fit, and the growth path"}
position is 0–100 on each competency's named axis (NEITHER end is good — it's a style placement). All eight competencies MUST appear exactly once, in this order: ${COMPETENCY_ORDER.join(", ")}.
decisive_moments: give 3-6, the actual turning points — each must name the literal action, not a generality, and be marked strength or growth_edge.`;
}

/** Build the evidence digest: transcript + quantified per-report outcome + timing + level anchors. */
function buildDigest(state: SaveState, cfg: InterviewConfig, timings: ResponseTiming[]): string {
  const name = (id: string) => state.characters[id]?.name ?? id;

  const transcript = state.history
    .filter((h) => h.kind !== "opening")
    .map((h) => {
      const shifts = h.shifts?.length ? ` | shifts: ${h.shifts.join("; ")}` : "";
      const t = timings.find((x) => x.turn === h.turn);
      const timing = t ? ` | pace ${t.pace_vs_expected}× expected${t.paused_before_typing ? ", paused first" : ""}` : "";
      return `T${h.turn} — CANDIDATE: ${h.player_action}\n   → ${h.summary}${shifts}${timing}`;
    })
    .join("\n");

  // edge start (first telemetry snapshot) → end (live), per report.
  const firstSnap = new Map<string, { warmth: number; trust: number }>();
  const firstTel = state.telemetry[0];
  if (firstTel) for (const e of firstTel.edge_snapshot) firstSnap.set(e.pair, { warmth: e.warmth, trust: e.trust });

  const reports = Object.entries(state.characters)
    .filter(([id]) => id !== "char_player")
    .map(([id, c]) => {
      const cond = state.condition[id];
      const edge = state.world.edges.find((e) => e.from === id && e.to === "char_player");
      const start = firstSnap.get(id);
      const wΔ = edge && start ? edge.warmth - start.warmth : (edge ? edge.warmth : 0);
      const tΔ = edge && start ? edge.trust - start.trust : (edge ? edge.trust : 0);
      const drive = c.drive?.goal ? `still wants: ${c.drive.goal}${c.drive.blocker ? ` (blocked: ${c.drive.blocker})` : ""}` : "no active drive";
      const psy = cond?.psyche;
      const openness = psy ? `${psy.mood} (relaxation ${psy.relaxation >= 0 ? "+" : ""}${psy.relaxation}, ${psy.state})` : "—";
      const gap = perceptionGap(state, id);
      const gapLine = gap ? `\n    ↳ their read of the candidate: ${gap}` : "";
      return `• ${c.name} — openness now: ${openness}; toward candidate: warmth Δ${wΔ >= 0 ? "+" : ""}${wΔ}, trust Δ${tΔ >= 0 ? "+" : ""}${tΔ}; ${drive}${gapLine}`;
    })
    .join("\n");

  const pressure = state.telemetry.map((t) => Math.round(t.pressure));
  const pressureLine = pressure.length ? `Pressure by turn: [${pressure.join(", ")}] (the simulation's traced tension — use for the under-pressure style + composure read)` : "";

  const objectives = cfg.objectives
    .map((o) => `  - [weight ${o.weight}] ${o.label} — success signal: ${o.success_signal}${o.target_report ? ` (watch: ${name(o.target_report)})` : ""}`)
    .join("\n");

  const compFocus = (cfg.role.key_competencies ?? COMPETENCY_ORDER)
    .map((c) => `${COMPETENCY_LABEL[c]} — ${COMPETENCY_DEF[c]}`)
    .join("\n");

  return `=== ROLE UNDER ASSESSMENT ===
${cfg.role.title} — ${LEVEL_LABEL[cfg.role.level]}
${cfg.role.summary}
${levelFlex(cfg.role.level)}

=== COMPETENCIES THIS ROLE WEIGHTS ===
${compFocus}

=== THE SITUATION THE CANDIDATE FACED ===
${cfg.opening_situation}
OPENING MESSAGE THEY SAW: ${cfg.opening_message}
FIXED END-STATE (they could not bypass this): ${cfg.end_state_note}

=== OBJECTIVES (per-scenario, local) ===
${objectives}

=== BEHAVIORAL ANCHORS (flexed for this level — score by matching) ===
${anchors()}

${crossFunctionalAnchor()}

=== TRANSCRIPT (every action the candidate took) ===
${transcript || "No turns were taken."}

=== QUANTIFIED OUTCOME (ground truth — the deltas the score rests on) ===
${reports}
${pressureLine}

=== RESPONSE PACING (for composure — pausing to think is positive; pure typing speed is irrelevant) ===
${summarizeTiming(timings)}`;
}

function emptyReport(turn: number, cfg: InterviewConfig): InterviewReport {
  return {
    generated_turn: turn, role_title: cfg.role.title, level: cfg.role.level,
    manager_type: "", summary: "", spine: [],
    cross_functional: { position: 50, read: "", evidence: "", mission_vs_silo: "" },
    objectives: [],
    style: { directive_participative: 50, task_relationship: 50, primary_style: "", under_pressure_style: "", pressure_shift_note: "", fit_read: "", fit_score: 0 },
    pressure: { composure_read: "", rushed_under_tension: false, breather_use: "" },
    relationship_deltas: [], missed_signals: [], decisive_moments: [],
    development_focus: [], strengths_to_keep: [],
    timing_summary: "", reviewer_note: "", decision_support_notice: DECISION_SUPPORT_NOTICE,
  };
}

/** Run the end-gate. Reads the full run + timing, returns the InterviewReport. */
export async function gradeInterview(state: SaveState, timings: ResponseTiming[]): Promise<InterviewReport> {
  const cfg = state.interview;
  if (!cfg?.enabled) throw new Error("This save is not an interview assessment.");

  const prefix = stablePrefix(state);
  const digest = buildDigest(state, cfg, timings);
  const msgs = buildMessages(
    INTERVIEW_ASSESSOR_SYSTEM + "\n\n" + interviewSchemaHint(),
    prefix,
    digest + "\n\nReview this practice scenario now. Output ONLY the JSON report.",
    state.model_settings.simulator_model,
  );

  let g: Partial<InterviewReport> | null = null, lastErr = "";
  for (const m of [state.model_settings.simulator_model, state.model_settings.fallback_model]) {
    try {
      const out = await complete(msgs, m, m, true, 4500);
      g = safeJson<Partial<InterviewReport>>(out.text, null as any);
      if (g && Array.isArray(g.spine) && g.spine.length) break;
      lastErr = `model ${m} returned an incomplete report`; g = null;
    } catch (e: any) { lastErr = `${m}: ${e.message}`; g = null; }
  }
  if (!g) throw new Error(`The review failed — ${lastErr}. Try a stronger model in Settings.`);

  const report = { ...emptyReport(state.world.current_turn, cfg), ...g, decision_support_notice: DECISION_SUPPORT_NOTICE };

  const clamp = (v: any) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  const byComp = new Map<Competency, any>();
  for (const sc of report.spine ?? []) if (sc?.competency) byComp.set(sc.competency, sc);
  report.spine = COMPETENCY_ORDER.map((comp) => {
    const sc = byComp.get(comp);
    return {
      competency: comp, label: COMPETENCY_LABEL[comp], position: clamp(sc?.position ?? 50),
      read: sc?.read ?? "", evidence: sc?.evidence ?? "",
      in_this_situation: sc?.in_this_situation ?? "", to_develop: sc?.to_develop ?? "",
    };
  });

  report.cross_functional = {
    position: clamp(report.cross_functional?.position ?? 50),
    read: report.cross_functional?.read ?? "",
    evidence: report.cross_functional?.evidence ?? "",
    mission_vs_silo: report.cross_functional?.mission_vs_silo ?? "",
  };
  report.style.directive_participative = clamp(report.style.directive_participative);
  report.style.task_relationship = clamp(report.style.task_relationship);
  report.style.fit_score = clamp(report.style.fit_score);
  report.objectives = (report.objectives ?? []).map((o: any) => ({ id: o.id ?? "", label: o.label ?? "", met: !!o.met, evidence: o.evidence ?? "" }));
  report.decisive_moments = (report.decisive_moments ?? []).map((m: any) => ({ turn: Number(m.turn) || 0, action: m.action ?? "", consequence: m.consequence ?? "", kind: m.kind === "strength" ? "strength" : "growth_edge" }));
  report.development_focus = Array.isArray(report.development_focus) ? report.development_focus.filter(Boolean) : [];
  report.strengths_to_keep = Array.isArray(report.strengths_to_keep) ? report.strengths_to_keep.filter(Boolean) : [];
  for (const r of report.relationship_deltas ?? []) if (!r.name && r.report_id) r.name = state.characters[r.report_id]?.name ?? r.report_id;
  if (!report.timing_summary) report.timing_summary = summarizeTiming(timings);

  return report;
}
