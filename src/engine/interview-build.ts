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
      "This is a hiring work-sample assessment. The PLAYER is the candidate, acting as the manager. Everyone else is a report or peer with a fixed, authored disposition. Render a realistic workplace and let the reports behave consistently with their authored personality and hidden driver — including authored skepticism or friction where specified — but never melodrama, never plot twists. The candidate must do the reading of the room themselves: do not have characters announce their inner state. Stay grounded and professional. Each turn, the situation should move in response to what the candidate actually does.",
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
