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

const DECISION_SUPPORT_NOTICE =
  "This report is decision-support evidence for a trained human reviewer. It is NOT a hire/no-hire decision and must not be used as an automated gate. Scores reflect behavior within a simulation and should be weighed alongside other evidence. Validate this instrument against on-the-job outcomes and audit it for adverse impact before using it in selection.";

/** Level flex: the same competency means different correct behavior at different levels. */
function levelFlex(level: ManagerLevel): string {
  const m: Record<ManagerLevel, string> = {
    first_line: "LEVEL — FIRST-LINE SUPERVISOR: hands-on is correct. Directly addressing a report's behavior, mediating a dispute themselves, and setting expectations in person are the right moves and score high when done well.",
    manager_of_managers: "LEVEL — MANAGER OF MANAGERS: the job is to work THROUGH the lead, not around them. A candidate who jumps in to mediate the individual contributors directly is making an ERROR — score conflict_management, developing_people, and decision_making DOWN for it and say why (the lead is undercut and learns nothing). High scores go to coaching the lead, setting expectations with the lead, and resisting the satisfying direct fix.",
    peer_lead: "LEVEL — PEER LEAD (no formal authority): directive moves that rely on positional power score DOWN because that power isn't available and it breeds resentment among peers. High scores go to influence: building shared ownership, making the case, surfacing the deadline as a shared problem. Pulling rank is a fairness and influence FAILURE here.",
  };
  return m[level];
}

/** Behaviorally-anchored rating scales for all eight spine competencies, at ~2/~5/~8.
 *  Anchors reference observable outcomes (the deltas) so scoring is a matching task. */
function anchors(): string {
  return `Score each competency 0–100 by matching the transcript to the closest behavioral anchor. Anchors describe OBSERVABLE actions and the state outcomes they tend to produce.

PROBLEM DIAGNOSIS — read the situation before committing.
  8: Surfaced facts and the real driver from more than one party before acting; named what was still unknown; the hidden driver of at least one report came to light.
  5: Gathered partial context, acted on an incomplete picture; one key voice unheard.
  2: Jumped to a solution on the first move; assumed the problem's shape; missed the hidden driver entirely.

CONFLICT MANAGEMENT — engage disagreement with a fit-for-situation approach.
  8: Chose an approach fit for stakes and people and executed it; the disputing parties' trust held or rose, clench did not spike.
  5: Defaulted to one mode regardless of fit; partial resolution, residual heat.
  2: Avoided the conflict or forced a resolution that spiked a party's clench and dropped their trust sharply.

DECISION-MAKING — a timely, reasoned call under incomplete information.
  8: Made a clear, defensible decision when one was due, gave a reason, and owned it; did not stall past the point of usefulness or lurch without basis.
  5: Decided, but late, hedged, or under-justified.
  2: Either froze and let the situation decide for them, or fired off an arbitrary call with no reasoning.

COMMUNICATION — clear, direct, calibrated; expectations unambiguous.
  8: Messages were clear and direct, matched to the listener; expectations and any deadline were stated unambiguously and understood.
  5: Generally clear but vague on the what/why, or one message likely to be misread.
  2: Ambiguous, evasive, or mismatched to the listener; left people unsure what was expected.

INFLUENCE & PERSUASION — move people via reasoning and ownership.
  8: Built buy-in through framing, reasoning, or shared ownership; people moved because they were persuaded, reflected in warming/trust.
  5: Some persuasion, leaned partly on position; mixed movement.
  2: Relied on authority or pressure with no buy-in; compliance at best, resentment at worst.

DEVELOPING PEOPLE — coach, delegate, protect engagement.
  8: Coached rather than dictated where apt; delegated appropriately for the level; the high performer's drive stayed productive (no drift toward exit).
  5: Some coaching but mostly told; or held one person at the cost of another's engagement.
  2: No development; the high performer's drive shifted toward leaving, or a report was thrown under the bus.

COMPOSURE UNDER PRESSURE — self-management; doesn't transmit stress. (Read WITH the timing signal.)
  8: Held composure as tension rose; paused to think before high-stakes replies rather than firing back; did not make the team the outlet for pressure.
  5: Mostly composed, one or two reactive moments.
  2: Visibly rattled — rushed exactly when pressure spiked, or transmitted stress onto the team.

FAIRNESS & INTEGRITY — equitable, and seen to be; procedural justice.
  8: Heard each party before forming/announcing a position; named tradeoffs openly; no party's trust dropped from feeling unheard; acted with integrity.
  5: Heard one side fully, the other partially; a slighted party cooled modestly.
  2: Formed/announced a position before a party spoke, or acted with evident partiality; that party's trust dropped and didn't recover.`;
}

export const INTERVIEW_ASSESSOR_SYSTEM = `You are the Assessor for a management hiring WORK-SAMPLE. A candidate has just managed a live, reactive team situation in a simulation, as the manager for a specific role. Turn the transcript and the simulation's QUANTIFIED outcome into structured, numerical, evidence-cited assessment for a human reviewer.

ASSESS MANAGERIAL DECISIONS, NOT WRITING. Score what the candidate DID as a manager — how they diagnosed, decided, handled conflict, influenced, developed people, held composure, and treated people fairly. Do NOT reward eloquent prose or penalize terse, plain, non-native, or unpolished writing. Two candidates who take the same managerial action score the same regardless of phrasing. This is a fairness requirement, not a stylistic preference.

GROUND EVERY SCORE IN STATE AND CITE THE TURN. The simulation already quantified how the interaction landed: each report's openness (relaxation), the warmth/trust deltas toward the candidate, whether the high performer's drive drifted toward leaving, which rumors spread. These are ground truth. For every claim, cite the turn(s) that justify it. When your read of the prose and the deltas disagree, the DELTAS win — say so in state_note. Never invent evidence.

SCORE BY MATCHING ANCHORS. For each competency you are given behavioral anchors at ~2/~5/~8. Match the transcript to the closest anchor, name it, and score around it. The anchors are FLEXED BY THE ROLE'S LEVEL (below); the level is fixed and authoritative. If the candidate acted at the wrong level (e.g. a manager-of-managers who mediated directly), that is an ERROR to score and explain — not a reason to re-grade them as a different level.

USE THE TIMING SIGNAL FOR COMPOSURE. You are given a pacing summary. Pausing to think before a high-stakes reply is a POSITIVE composure signal (the candidate took a breath under tension). Firing back fast exactly when pressure spiked is a negative one. Pure typing speed is irrelevant — never treat slow typing as a deficiency.

NAME THE STYLE NEUTRALLY, JUDGE FIT SEPARATELY. Place the candidate on two neutral axes (directive↔participative, task↔relationship) as numbers, name the primary style, and report how it SHIFTS under pressure (the simulation traces pressure explicitly). Directive is not worse than participative — it is better or worse FOR THIS role and team, and that fit judgment is its own score.

BE DESCRIPTIVE, NOT A VERDICT. Do not output a hire/no-hire recommendation. Produce evidence: scores, cited moments, what worked, what to change, and a reviewer paragraph. A human decides.

OUTPUT ONLY THE JSON OBJECT. No markdown fences, no commentary.`;

export function interviewSchemaHint(): string {
  return `JSON shape (all keys required; [] / "" when empty):
{"summary":"descriptive headline for the reviewer — strengths and gaps, no hire/no-hire",
"overall":0,
"spine":[{"competency":"problem_diagnosis|conflict_management|decision_making|communication|influence|developing_people|emotional_regulation|fairness_integrity","label":"","score":0,"anchor_matched":"~2|~5|~8 paraphrase","evidence":"cite turn(s)","what_worked":"","what_to_change":"","state_note":"how the deltas corroborate or contradict"}],
"objectives":[{"id":"","label":"","met":false,"score":0,"evidence":"cite turn(s)"}],
"style":{"directive_participative":0,"task_relationship":0,"primary_style":"","under_pressure_style":"","pressure_shift_note":"","fit_read":"fit to THIS role & team, with a reason","fit_score":0},
"pressure":{"composure_read":"","rushed_under_tension":false,"breather_use":"did they pause before high-stakes replies or fire back"},
"relationship_deltas":[{"report_id":"","name":"","warmth_delta":0,"trust_delta":0,"read":"one line"}],
"missed_signals":["a report's hidden driver the candidate never surfaced"],
"strongest_moments":[{"turn":0,"note":""}],
"costliest_moments":[{"turn":0,"note":""}],
"timing_summary":"plain-language read of the response-pace pattern",
"reviewer_note":"one paragraph for the human decision-maker"}
All eight competencies MUST appear exactly once, in this order: ${COMPETENCY_ORDER.join(", ")}.`;
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
      return `• ${c.name} — openness now: ${openness}; toward candidate: warmth Δ${wΔ >= 0 ? "+" : ""}${wΔ}, trust Δ${tΔ >= 0 ? "+" : ""}${tΔ}; ${drive}`;
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
    summary: "", overall: 0, spine: [], objectives: [],
    style: { directive_participative: 50, task_relationship: 50, primary_style: "", under_pressure_style: "", pressure_shift_note: "", fit_read: "", fit_score: 0 },
    pressure: { composure_read: "", rushed_under_tension: false, breather_use: "" },
    relationship_deltas: [], missed_signals: [], strongest_moments: [], costliest_moments: [],
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
    digest + "\n\nGrade the work-sample now. Output ONLY the JSON InterviewReport.",
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
  if (!g) throw new Error(`The assessor failed — ${lastErr}. Try a stronger simulator model in Tuning.`);

  const report = { ...emptyReport(state.world.current_turn, cfg), ...g, decision_support_notice: DECISION_SUPPORT_NOTICE };

  const clamp = (v: any) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  const byComp = new Map<Competency, any>();
  for (const sc of report.spine ?? []) if (sc?.competency) byComp.set(sc.competency, sc);
  report.spine = COMPETENCY_ORDER.map((comp) => {
    const sc = byComp.get(comp);
    return {
      competency: comp, label: COMPETENCY_LABEL[comp], score: clamp(sc?.score),
      anchor_matched: sc?.anchor_matched ?? "", evidence: sc?.evidence ?? "",
      what_worked: sc?.what_worked ?? "", what_to_change: sc?.what_to_change ?? "", state_note: sc?.state_note ?? "",
    };
  });

  const meanSpine = Math.round(report.spine.reduce((a, sc) => a + sc.score, 0) / report.spine.length);
  report.overall = clamp(report.overall) || meanSpine;
  report.style.directive_participative = clamp(report.style.directive_participative);
  report.style.task_relationship = clamp(report.style.task_relationship);
  report.style.fit_score = clamp(report.style.fit_score);
  for (const o of report.objectives ?? []) o.score = clamp(o.score);
  for (const r of report.relationship_deltas ?? []) if (!r.name && r.report_id) r.name = state.characters[r.report_id]?.name ?? r.report_id;
  if (!report.timing_summary) report.timing_summary = summarizeTiming(timings);

  return report;
}
