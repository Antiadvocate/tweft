/**
 * WEFT-INTERVIEW — turn 0 (the HR / designer build-out).
 *
 * Everything here happens BEFORE the scene loads and is then FIXED, so every
 * candidate for a role faces the identical setup. HR can:
 *   - paste a job description → extractRole() seeds the candidate's RoleSpec
 *   - paste a JD per report   → extractReport() seeds a ReportSpec, then HR adds personality
 *   - or author reports entirely by hand
 *   - write the literal opening message + situation the candidate first sees
 *   - set the locked time budget, the end-state, and a password-gated reviewer scope
 *
 * The builder exposes full behavioral authoring of reports but NO protected-identity
 * field keyed to the candidate — by design (see interview-types.ts).
 */
import type { SaveState, WorldBible } from "./types";
import type {
  InterviewConfig, RoleSpec, ReportSpec, ScenarioObjective,
  ManagerLevel, TimeBudget, Competency,
} from "./interview-types";
import { newSave, registerCharacter, uid } from "./state";
import { syncPresence } from "./turn";
import { makeScopePassword } from "./interview-timing";
import { buildMessages, complete, safeJson } from "../llm";

// ───────────────────────────── JD extractors ─────────────────────────────

const ROLE_EXTRACT_SYSTEM = `You read a job description for a MANAGEMENT role and extract a structured summary for a hiring work-sample assessment. Output ONLY JSON:
{"title":"","level":"first_line|manager_of_managers|peer_lead","summary":"2-4 sentences on the role's scope and responsibilities","key_competencies":["pick 3-6 from: problem_diagnosis, conflict_management, decision_making, communication, influence, developing_people, emotional_regulation, fairness_integrity — the ones this role most depends on"]}
Infer level from the description: first_line manages individual contributors; manager_of_managers manages other managers/leads; peer_lead leads peers without formal authority. If unclear, choose first_line.`;

const VALID_COMPS: Competency[] = [
  "problem_diagnosis", "conflict_management", "decision_making", "communication",
  "influence", "developing_people", "emotional_regulation", "fairness_integrity",
];

export async function extractRole(jd: string, model = "deepseek/deepseek-chat-v3-0324"): Promise<RoleSpec> {
  const msgs = buildMessages(ROLE_EXTRACT_SYSTEM, "JOB DESCRIPTION:", jd, model);
  const out = await complete(msgs, model, "google/gemini-2.0-flash-001", true, 1500);
  const g = safeJson<any>(out.text, {});
  const level: ManagerLevel = ["first_line", "manager_of_managers", "peer_lead"].includes(g.level) ? g.level : "first_line";
  const key = Array.isArray(g.key_competencies) ? g.key_competencies.filter((c: string) => VALID_COMPS.includes(c as Competency)) : [];
  return {
    title: g.title || "Manager",
    level,
    summary: g.summary || jd.slice(0, 400),
    key_competencies: key.length ? key : undefined,
  };
}

const REPORT_EXTRACT_SYSTEM = `You read a job description for an INDIVIDUAL role and extract a structured profile for a person who holds it, to seed a character in a management assessment. Output ONLY JSON:
{"role_title":"","job_summary":"2-3 sentences on what they do","experience":"a plausible experience level for this role","is_lead":false,"is_high_performer":false,"suggested_traits":["3-5 neutral professional traits that fit the role"],"speech_pattern":"how someone in this role tends to communicate"}
Do NOT invent hostility, grievances, or personality conflict — those are authored separately by the designer. Keep this a neutral, professional baseline. is_lead is true only if the role manages other people.`;

export async function extractReport(jd: string, model = "deepseek/deepseek-chat-v3-0324"): Promise<Partial<ReportSpec>> {
  const msgs = buildMessages(REPORT_EXTRACT_SYSTEM, "JOB DESCRIPTION:", jd, model);
  const out = await complete(msgs, model, "google/gemini-2.0-flash-001", true, 1500);
  const g = safeJson<any>(out.text, {});
  return {
    role_title: g.role_title || "Team Member",
    job_summary: g.job_summary || "",
    experience: g.experience || "",
    is_lead: !!g.is_lead,
    is_high_performer: !!g.is_high_performer,
    personality_traits: Array.isArray(g.suggested_traits) ? g.suggested_traits.slice(0, 5) : [],
    speech_pattern: g.speech_pattern || "professional",
  };
}

// ───────────────────────────── assembly ─────────────────────────────

export interface InterviewBuildInput {
  role: RoleSpec;
  reports: ReportSpec[];               // fully authored (hand or JD-seeded + designer personality)
  opening_message: string;             // the literal first message the candidate sees
  opening_situation: string;           // framing shown before they begin
  end_state_note: string;              // the fixed end-state they cannot bypass
  objectives: ScenarioObjective[];
  time_budget: TimeBudget;
  scope_password?: string;             // if set, enables password-gated reviewer scopes
  organization_name?: string;
  designer_notes?: string;
  company_canon?: string[];            // internal facts the sim treats as ground truth (e.g. "the on-call contractor has a ~12-min response delay")
}

/** Build a locked interview SaveState. The candidate plays it through the normal
 *  turn loop; the InterviewConfig drives the clock, scopes, and grading. */
export async function assembleInterview(input: InterviewBuildInput): Promise<SaveState> {
  const orgName = input.organization_name?.trim() || `${input.role.title} — assessment`;

  const bible: WorldBible = {
    name: orgName,
    era: "present day",
    technology_level: "ordinary modern workplace",
    magic_rules: "None. This is a realistic workplace.",
    forbidden: "Melodrama, plot twists, secret identities, violence, romance. Keep it professional and grounded.",
    what_people_fear: "missing the deadline, being blamed, being overlooked, losing standing",
    cultures_and_languages: "A modern professional workplace.",
    climate_and_geography: "An office / hybrid work setting.",
    calendar_and_currency: "Standard work calendar.",
    political_situation: input.opening_situation || "A team under pressure with real work to get done.",
    narrator_direction:
      "This is a hiring work-sample assessment. The PLAYER is the candidate, acting as the manager. Everyone else is a report or peer with a fixed, authored disposition. " +
      "WRITE LIKE A WORKPLACE TRANSCRIPT, NOT A NOVEL. Keep prose plain, clear, and easy to read for anyone. When a report speaks, attribute it simply on its own line — e.g. Maya: \"I don't think we should ship Friday.\" Use short paragraphs. Describe actions and reactions plainly (\"Devin crosses his arms and looks at the floor\") without literary flourish, metaphor, or scene-setting prose. No omniscient narration, no interior monologue for the characters, no chapter-book style. Think meeting notes that capture who said what and how people reacted. " +
      "Let the reports behave consistently with their authored personality and hidden driver — including authored skepticism or friction where specified — but never melodrama, never plot twists. The candidate must do the reading of the room themselves: do not have characters announce their inner state. Each turn, the situation should move in response to what the candidate actually does.",
    god_mode: false,
    difficulty_profile: { lethality: "low", friction_density: "balanced", antagonist_aggression: "slow_burn", protagonist_competence: "average" },
    forbidden_as_primary: ["violence", "romance", "the supernatural", "plot twists"],
  };

  const s = newSave(bible.name, bible);

  // the candidate is the player — deliberately a blank professional vessel.
  // We do NOT author the candidate's identity; they bring their own choices, not a fixed persona.
  registerCharacter(s, {
    character_id: "char_player",
    name: "You",
    age: 38,
    pronouns: "they/them",
    background: `The manager being assessed for: ${input.role.title}. ${input.role.summary}`,
    core_traits: [],
    values: [],
    speech_pattern: "professional",
  });
  s.memory["char_player"].core = [`Role under assessment: ${input.role.title}. ${input.role.summary}`];

  // one shared working space
  const lid = uid("loc");
  s.world.places[lid] = { id: lid, name: `${orgName} — team space`, description_facts: "the team's shared working space", contains: [] };
  s.world.player_location = lid;
  s.characters["char_player"].location = lid;

  // reports — authored disposition + hidden driver baked into background/drive (engine hides it naturally)
  const specToId: Record<string, string> = {};
  for (const r of input.reports) {
    const cid = registerCharacter(s, {
      name: r.name,
      age: 34,
      pronouns: r.pronouns,
      background: [
        r.job_summary ? `Role: ${r.role_title}. ${r.job_summary}` : `Role: ${r.role_title}.`,
        r.experience ? `Experience: ${r.experience}.` : "",
        r.disposition_to_manager ? `Toward a new manager: ${r.disposition_to_manager}` : "",
        r.hidden_driver ? `Privately (do not state outright): ${r.hidden_driver}` : "",
      ].filter(Boolean).join(" "),
      core_traits: r.personality_traits ?? [],
      values: [],
      speech_pattern: r.speech_pattern ?? "professional",
      tracked: true,
      location: lid,
      drive: r.hidden_driver ? { goal: r.hidden_driver, progress: 10, priority: r.is_high_performer ? 2 : 1, updated_turn: 1 } : undefined,
    });
    specToId[r.id] = cid;
    s.memory[cid].core = [r.job_summary, r.hidden_driver].filter(Boolean);
    s.world.edges.push({
      from: cid, to: "char_player",
      warmth: Math.max(-100, Math.min(100, r.starting_warmth ?? 0)),
      trust: Math.max(-100, Math.min(100, r.starting_trust ?? 0)),
      power: 0,
      roles: [r.is_lead ? "your direct report (a lead)" : "your report"],
      notes: r.role_title,
      updated_turn: 1,
    });
  }

  syncPresence(s);

  // company-canon: internal facts the simulation treats as ground truth. These ride in
  // world.canon (always in context, never pruned), so the narrator honors them — but they
  // are NOT part of the grading rubric; a candidate isn't penalized for not knowing an
  // obscure internal fact unless the scenario surfaces it.
  for (const fact of input.company_canon ?? []) {
    const f = fact.trim();
    if (f && !s.world.canon.some((c) => c.toLowerCase() === f.toLowerCase())) s.world.canon.push(f);
  }

  // the opening message the candidate sees — stored as the fixed opening scene (turn 0, kind:"opening").
  if (input.opening_message?.trim()) {
    s.history = [{
      turn: 0, kind: "opening", player_action: "",
      narrator_prose: input.opening_message.trim(),
      summary: "The situation as it opens.", offscreen: [],
      time_label: s.world.current_time, weather: s.world.weather,
    }];
  }

  // remap objective target_report ids (spec id → engine char id)
  const objectives = input.objectives.map((o, i) => ({
    ...o,
    id: o.id || `obj_${i + 1}`,
    target_report: o.target_report ? specToId[o.target_report] : undefined,
  }));

  // password-gated reviewer scopes
  const scopes = input.scope_password?.trim()
    ? { enabled: true, ...(await makeScopePassword(input.scope_password.trim())) }
    : { enabled: false, password_hash: "", password_salt: "" };

  const config: InterviewConfig = {
    enabled: true,
    role: input.role,
    reports: input.reports,
    opening_message: input.opening_message,
    opening_situation: input.opening_situation,
    objectives,
    time_budget: input.time_budget,
    scopes,
    end_state_note: input.end_state_note,
    designer_notes: input.designer_notes,
  };
  s.interview = config;

  return s;
}

/** A sensible default time budget HR can tweak. */
export function defaultTimeBudget(totalMinutes = 15): TimeBudget {
  return {
    total_seconds: Math.max(60, Math.round(totalMinutes * 60)),
    starts_on_first_response: true,
    assumed_wpm: 40,    // unhurried typing baseline; configurable
    reading_wpm: 250,   // average silent reading
  };
}

// ───────────────────────────── example scenario (rapid testing) ─────────────────────────────

const EXAMPLE_SYSTEM = `You invent a COMPLETE, realistic management work-sample scenario for testing a hiring-assessment app. Make it specific and a little unusual — not the generic "two engineers disagree" — but always grounded in ordinary workplace reality (no melodrama). Output ONLY JSON:
{"organization_name":"a believable company/team name",
"role":{"title":"the manager role being assessed","level":"first_line|manager_of_managers|peer_lead","summary":"2-3 sentences on the manager's scope"},
"reports":[{"name":"","role_title":"","job_summary":"1-2 sentences","experience":"plausible","is_lead":false,"is_high_performer":false,"personality_traits":["3-4 traits"],"disposition_to_manager":"how they treat a new manager, with a reason — may include authored friction","hidden_driver":"what they really want or fear, surfaced only by good diagnosis","starting_warmth":0,"starting_trust":0,"speech_pattern":""}],
"opening_situation":"1-2 sentences framing what the candidate walks into",
"opening_message":"the literal first message/scene the candidate sees, ending on a beat that invites action",
"end_state_note":"what 'the scenario is over' means",
"objectives":[{"label":"","success_signal":"tied to an observable outcome","target_report_name":"","weight":3}],
"company_canon":["1-3 internal facts the AI couldn't guess that the team treats as normal — e.g. an approval process, a tooling quirk, a standing constraint"]}
Use 3-4 reports with genuinely competing wants. Vary names and demographics naturally and incidentally — never make identity the subject of the test. starting_warmth/trust in [-100,100], mostly mild (-30..30).`;

export interface ExampleInput { jd?: string; minutes?: number; model?: string; }

/** The builder's form shape — what an example scenario fills in for tweaking. */
export interface ScenarioDraft {
  organization_name: string;
  role: RoleSpec;
  reports: ReportSpec[];
  opening_situation: string;
  opening_message: string;
  end_state_note: string;
  objectives: ScenarioObjective[];   // target_report holds a report SPEC id (r_N), matching reports[].id
  company_canon: string[];
  minutes: number;
}

/** Generate a complete example scenario as editable DRAFT fields (does NOT assemble/save).
 *  The builder calls this to prefill its form so the designer can tweak before launching. */
export async function draftExampleScenario(input: ExampleInput = {}): Promise<ScenarioDraft> {
  const model = input.model ?? "deepseek/deepseek-chat-v3-0324";
  const seed = input.jd?.trim()
    ? `Seed the manager role from this job description, then invent a fitting team and situation:\n${input.jd.trim()}`
    : `Invent a fresh, specific scenario from scratch. Pick an industry at random (not always tech).`;
  const msgs = buildMessages(EXAMPLE_SYSTEM, "Generate one complete scenario.", seed, model);

  let g: any = null, lastErr = "";
  for (const m of [model, model, "google/gemini-2.0-flash-001"]) {
    try {
      const out = await complete(msgs, m, m, true, 4000);
      g = safeJson<any>(out.text, null);
      if (g?.role?.title && Array.isArray(g.reports) && g.reports.length >= 2 && g.opening_message) break;
      lastErr = `model ${m} returned an incomplete scenario`; g = null;
    } catch (e: any) { lastErr = `${m}: ${e.message}`; g = null; }
  }
  if (!g) throw new Error(`Example generation failed — ${lastErr}.`);

  const level: ManagerLevel = ["first_line", "manager_of_managers", "peer_lead"].includes(g.role?.level) ? g.role.level : "first_line";
  const reports: ReportSpec[] = (g.reports ?? []).map((r: any, i: number) => ({
    id: `r_${i + 1}`,
    name: r.name || `Report ${i + 1}`,
    role_title: r.role_title || "Team Member",
    job_summary: r.job_summary || "",
    experience: r.experience || "",
    is_lead: !!r.is_lead,
    is_high_performer: !!r.is_high_performer,
    personality_traits: Array.isArray(r.personality_traits) ? r.personality_traits.slice(0, 5) : [],
    disposition_to_manager: r.disposition_to_manager || "",
    hidden_driver: r.hidden_driver || "",
    starting_warmth: clampN(r.starting_warmth, -100, 100),
    starting_trust: clampN(r.starting_trust, -100, 100),
    speech_pattern: r.speech_pattern || "professional",
  }));
  const nameToSpecId: Record<string, string> = {};
  for (const r of reports) nameToSpecId[r.name.toLowerCase()] = r.id;

  return {
    organization_name: g.organization_name || "Example Co.",
    role: { title: g.role.title, level, summary: g.role.summary || "" },
    reports,
    opening_situation: g.opening_situation || "",
    opening_message: g.opening_message || "",
    end_state_note: g.end_state_note || "The scenario is complete.",
    objectives: (g.objectives ?? []).map((o: any, i: number) => ({
      id: `obj_${i + 1}`,
      label: o.label || `Objective ${i + 1}`,
      success_signal: o.success_signal || "",
      target_report: o.target_report_name ? nameToSpecId[String(o.target_report_name).toLowerCase()] : undefined,
      weight: clampN(o.weight, 1, 5) || 3,
    })),
    company_canon: Array.isArray(g.company_canon) ? g.company_canon.slice(0, 4) : [],
    minutes: input.minutes ?? 15,
  };
}

/** Invent a full scenario and assemble it directly (kept for convenience / programmatic use). */
export async function exampleInterview(input: ExampleInput = {}): Promise<SaveState> {
  const d = await draftExampleScenario(input);
  const build: InterviewBuildInput = {
    role: d.role, reports: d.reports,
    opening_message: d.opening_message, opening_situation: d.opening_situation,
    end_state_note: d.end_state_note, objectives: d.objectives,
    time_budget: defaultTimeBudget(d.minutes),
    organization_name: d.organization_name, company_canon: d.company_canon,
    designer_notes: "Generated example scenario (for testing).",
  };
  return assembleInterview(build);
}

function clampN(v: any, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, Math.round(Number(v) || 0))); }
