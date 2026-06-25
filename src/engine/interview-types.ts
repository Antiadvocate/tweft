/**
 * WEFT-INTERVIEW — management work-sample assessment types.
 *
 * This is a HIRING assessment instrument, so the design is governed by selection
 * fairness, not story. Every candidate for a role faces the BYTE-IDENTICAL setup
 * (same opening message, same reports, same rubric, same time budget), the clock
 * is LOCKED (hard start at first-response, hard end that can't be bypassed), and
 * the rubric is grounded in standard structured-interview competency frameworks
 * (SHRM leadership competencies; OPM structured-interview competencies) rather
 * than an invented list.
 *
 * THE LINE (settled in design): identity can be a FIXED property of the scenario
 * (a report's disposition, background, how they react to authority) but is NEVER a
 * variable attached to the candidate, and the report builder exposes no protected-
 * characteristic field keyed to the candidate. We assess what the candidate DOES;
 * we never vary who the candidate IS. This keeps the instrument both valid (not
 * scoring reactions to the model's stereotypes) and lawful (no protected trait
 * moving a candidate's score).
 *
 * DECISION SUPPORT, NOT DECISION MAKER: the output is evidence a human reviewer
 * weighs. It must never be wired as an automated pass/fail gate.
 */

// ───────────────────────────── competency spine (grounded) ─────────────────────────────

/**
 * The management competency spine. Drawn from the convergent set across SHRM's
 * leadership competencies (conflict management, decision-making, communication,
 * relationship management, coaching/developing others, emotional intelligence /
 * self-management) and OPM's structured-interview competencies (conflict
 * management, interpersonal skills, influencing/negotiating, oral communication,
 * problem solving). These are observable in a single live management interaction.
 *
 * Each is scored against tiered behavioral anchors and aggregates into a profile
 * comparable across candidates for the same role.
 */
export type Competency =
  | "problem_diagnosis"     // gathers facts/assesses the situation before committing (problem solving)
  | "conflict_management"   // engages disagreement with a fit-for-situation mode; de-escalates
  | "decision_making"       // makes a timely, reasoned call under incomplete information
  | "communication"         // clear, direct, calibrated to the listener; clarity of expectations
  | "influence"             // moves people via reasoning/ownership, not just position (influencing/negotiating)
  | "developing_people"     // coaches, delegates, protects engagement (developing others)
  | "emotional_regulation"  // composure under pressure; self-management; doesn't transmit stress
  | "fairness_integrity";   // treats people equitably and is seen to; procedural justice; ethical practice

export const COMPETENCY_ORDER: Competency[] = [
  "problem_diagnosis", "conflict_management", "decision_making", "communication",
  "influence", "developing_people", "emotional_regulation", "fairness_integrity",
];

export const COMPETENCY_LABEL: Record<Competency, string> = {
  problem_diagnosis: "Problem diagnosis",
  conflict_management: "Conflict management",
  decision_making: "Decision-making",
  communication: "Communication",
  influence: "Influence & persuasion",
  developing_people: "Developing people",
  emotional_regulation: "Composure under pressure",
  fairness_integrity: "Fairness & integrity",
};

/** Short source-grounded definition shown in the builder so HR knows what each measures. */
export const COMPETENCY_DEF: Record<Competency, string> = {
  problem_diagnosis: "Gathers relevant facts and reads the situation before acting; distinguishes symptom from cause.",
  conflict_management: "Engages disagreement directly with an approach fit for the stakes and people; de-escalates rather than inflames.",
  decision_making: "Makes a timely, reasoned decision under incomplete information and owns it.",
  communication: "Communicates clearly and directly, calibrated to the listener; sets expectations unambiguously.",
  influence: "Moves people through reasoning, framing, and shared ownership rather than positional power alone.",
  developing_people: "Coaches, delegates appropriately, and protects the engagement and growth of the team.",
  emotional_regulation: "Maintains composure under pressure and does not transmit stress onto the team.",
  fairness_integrity: "Treats people equitably and is seen to; hears parties before forming a position; acts with integrity.",
};

// ───────────────────────────── managerial level ─────────────────────────────

export type ManagerLevel = "first_line" | "manager_of_managers" | "peer_lead";

export const LEVEL_LABEL: Record<ManagerLevel, string> = {
  first_line: "First-line supervisor",
  manager_of_managers: "Manager of managers",
  peer_lead: "Peer lead (no formal authority)",
};

// ───────────────────────────── turn-0 setup (HR / designer) ─────────────────────────────

/** A report (or peer) the candidate must manage. Authored at turn 0 and FIXED.
 *  Behavioral texture is fully customizable; protected identity keyed to the
 *  candidate is intentionally not a field. */
export interface ReportSpec {
  id: string;
  name: string;
  pronouns?: string;
  role_title: string;             // "Senior Backend Engineer"
  job_summary: string;            // responsibilities — can be LLM-extracted from a JD
  experience: string;             // "8 years, 3 on this team"
  is_lead?: boolean;              // they manage others (matters for manager_of_managers)
  is_high_performer?: boolean;
  // behavioral authoring — the friction the candidate must handle
  personality_traits: string[];   // "blunt", "perfectionist", "resents the reorg"
  disposition_to_manager: string; // "skeptical of a new manager; testing"; CAN include authored hostility w/ a stated reason
  hidden_driver: string;          // what they really want/fear — surfaced only by good diagnosis
  starting_warmth: number;        // -100..100 toward the manager at scene start
  starting_trust: number;         // -100..100
  speech_pattern?: string;
}

/** The job the CANDIDATE is being assessed for. Can be LLM-extracted from a JD. */
export interface RoleSpec {
  title: string;
  level: ManagerLevel;
  summary: string;                // responsibilities & scope of the manager role
  key_competencies?: Competency[];// which spine competencies this role weights most (defaults to all)
}

/** Per-scenario objective, tied to observable outcome where possible. Local; does not aggregate. */
export interface ScenarioObjective {
  id: string;
  label: string;
  success_signal: string;
  target_report?: string;         // report id whose state matters most
  weight: number;                 // 1–5
}

/** Time budget — the locked clock. */
export interface TimeBudget {
  total_seconds: number;          // hard scenario length; the run ends at this boundary, no bypass
  starts_on_first_response: true; // clock starts when the candidate begins their first reply
  // descriptive per-response timing baseline (configurable; NOT a typing-speed penalty)
  assumed_wpm: number;            // HR-set typing baseline for the length-adjusted expectation
  reading_wpm: number;            // assumed reading speed for the incoming message
  // a "breather" is healthy under tension — we measure latency BEFORE typing begins,
  // separately from typing duration, because pausing to think is a positive signal.
}

/** Password-gated reviewer scopes. The scopes (the reports' hidden internal state,
 *  surfaced live) are HIDDEN behind a toggle that requires a password set at build time.
 *  Never visible to the candidate during a scored run. */
export interface ScopeGate {
  enabled: boolean;               // are reviewer scopes available at all
  // password is stored hashed; the plaintext is set once at creation and never kept.
  password_hash: string;          // SHA-256 hex of the reviewer password
  password_salt: string;          // per-scenario salt
}

export interface InterviewConfig {
  enabled: true;
  role: RoleSpec;
  reports: ReportSpec[];
  // the literal opening the candidate sees, authored by HR
  opening_message: string;        // the first message in the candidate's inbox / the scene as it opens
  opening_situation: string;      // the framing the candidate is given before they start
  objectives: ScenarioObjective[];
  time_budget: TimeBudget;
  scopes: ScopeGate;
  // a fixed end-state prompt the candidate cannot skip past — what "the scenario is over" means
  end_state_note: string;         // e.g. "The standup is over and the deadline call has to be made."
  designer_notes?: string;
}

// ───────────────────────────── timing telemetry (per response) ─────────────────────────────

export interface ResponseTiming {
  turn: number;
  chars: number;
  words: number;
  // measured
  latency_ms: number;             // time from message shown → candidate STARTS typing (the breather)
  typing_ms: number;              // time from first keystroke → submit
  total_ms: number;               // latency + typing
  // expectation, from the configurable baseline + this response's length
  expected_typing_ms: number;     // words / assumed_wpm
  expected_reading_ms: number;    // incoming words / reading_wpm
  // descriptive read — NOT a score
  pace_vs_expected: number;       // total_ms / (expected_reading + expected_typing); ~1 = on pace, <1 = fast
  paused_before_typing: boolean;  // latency materially exceeded reading time → took a breath (positive)
}

// ───────────────────────────── the report ─────────────────────────────

/** A competency read as a POSITION on a spectrum, not a grade. Both ends are
 *  legitimate styles; which fits depends on the situation. The report characterizes
 *  what KIND of manager this is, not how good. */
export interface CompetencyRead {
  competency: Competency;
  label: string;
  // 0–100 position between two named, both-legitimate poles (see SPECTRUM_POLES)
  position: number;
  // a short read of where they landed and what it means here, e.g.
  // "Moved fast to a decision and owned it — decisive, but closed the question before Devin spoke."
  read: string;
  evidence: string;              // cites turn + literal action
  in_this_situation: string;     // whether that lean fit THIS scenario, with a reason
  // a forward-looking development note — this is a growth tool, not a verdict
  to_develop: string;
}

/** The two poles of each competency axis — both are valid management styles. */
export const SPECTRUM_POLES: Record<Competency, { low: string; high: string }> = {
  problem_diagnosis:    { low: "Acts fast on instinct", high: "Investigates before acting" },
  conflict_management:  { low: "Drives to resolution", high: "Draws out all sides" },
  decision_making:      { low: "Decides and commits",  high: "Builds consensus first" },
  communication:        { low: "Brief and directive",  high: "Detailed and explanatory" },
  influence:            { low: "Leads from position",  high: "Persuades and co-owns" },
  developing_people:    { low: "Does it directly",     high: "Coaches and delegates" },
  emotional_regulation: { low: "Reacts in the moment", high: "Pauses and stays measured" },
  fairness_integrity:   { low: "Moves on a read",      high: "Hears every party first" },
};

export interface ObjectiveScore {
  id: string; label: string; met: boolean; evidence: string;
}

export interface StyleProfile {
  directive_participative: number; // 0 directive .. 100 participative
  task_relationship: number;       // 0 task .. 100 relationship
  primary_style: string;
  under_pressure_style: string;
  pressure_shift_note: string;
  fit_read: string;                // fit to THIS role & team
  fit_score: number;
}

/** Cross-functional / silo axis — a subtle, secondary read (not the headline).
 *  Grounded in the org-behavior literature: silos are RATIONAL (local-metric
 *  optimization) but costly; boundary-spanning managers reach across functions to
 *  serve the mission. 0 = silo-protecting / turf-defending, 100 = boundary-spanning. */
export interface CrossFunctionalRead {
  position: number;                // 0 silo-protecting .. 100 boundary-spanning
  read: string;                    // what they did re: other groups/functions
  evidence: string;                // the moment it showed (or the chance they didn't take)
  mission_vs_silo: string;         // did they optimize the org's goal or their local one
}

export interface PressureHandling {
  composure_read: string;
  rushed_under_tension: boolean;
  breather_use: string;
}

/** A specific, literal management action and what it caused. The anti-generality field. */
export interface DecisiveMoment {
  turn: number;
  action: string;
  consequence: string;
  kind: "strength" | "growth_edge";  // not good/bad — a strength shown, or an edge to grow
}

export interface InterviewReport {
  generated_turn: number;
  role_title: string;
  level: ManagerLevel;
  // a CHARACTERIZATION of what kind of manager this is in this situation — not a verdict.
  manager_type: string;            // a short, evocative type-name, e.g. "Decisive operator, light on dissent"
  summary: string;                 // 2-3 sentences describing the style and its situational fit
  spine: CompetencyRead[];
  cross_functional: CrossFunctionalRead;
  objectives: ObjectiveScore[];
  style: StyleProfile;
  pressure: PressureHandling;
  relationship_deltas: { report_id: string; name: string; warmth_delta: number; trust_delta: number; read: string }[];
  missed_signals: string[];
  decisive_moments: DecisiveMoment[];
  // forward-looking development guidance — this is a growth/practice tool
  development_focus: string[];     // 2-4 concrete things to practice next
  strengths_to_keep: string[];     // 2-3 strengths worth reinforcing
  timing_summary: string;
  reviewer_note: string;           // a paragraph for whoever is developing this manager
  decision_support_notice: string;
}
