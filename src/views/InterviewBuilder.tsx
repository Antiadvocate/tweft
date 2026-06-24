import React, { useState } from "react";
import { api, type ScenarioDraft } from "../lib/api";
import type {
  RoleSpec, ReportSpec, ScenarioObjective, ManagerLevel, Competency,
} from "../engine/interview-types";
import { COMPETENCY_LABEL, COMPETENCY_ORDER, LEVEL_LABEL } from "../engine/interview-types";

const LEVELS: ManagerLevel[] = ["first_line", "manager_of_managers", "peer_lead"];

function uid() { return Math.random().toString(36).slice(2, 9); }

function blankReport(): ReportSpec {
  return {
    id: uid(), name: "", role_title: "", job_summary: "", experience: "",
    is_lead: false, is_high_performer: false, personality_traits: [],
    disposition_to_manager: "", hidden_driver: "", starting_warmth: 5, starting_trust: 0,
    speech_pattern: "professional",
  };
}

const field: React.CSSProperties = { background: "var(--surface-1, rgba(255,255,255,0.03))", border: "1px solid var(--border, rgba(255,255,255,0.08))" };
const lbl = "text-[11px] uppercase tracking-wide mb-1 block";
const lblStyle = { color: "var(--text-mid)" } as React.CSSProperties;

export default function InterviewBuilder({ onCreated }: { onCreated: (id: string) => void }) {
  // role
  const [roleJD, setRoleJD] = useState("");
  const [role, setRole] = useState<RoleSpec>({ title: "", level: "first_line", summary: "" });
  const [extractingRole, setExtractingRole] = useState(false);

  // reports
  const [reports, setReports] = useState<ReportSpec[]>([blankReport()]);

  // scenario
  const [openingSituation, setOpeningSituation] = useState("");
  const [openingMessage, setOpeningMessage] = useState("");
  const [endState, setEndState] = useState("");
  const [objectives, setObjectives] = useState<ScenarioObjective[]>([{ id: uid(), label: "", success_signal: "", weight: 3 }]);

  // timing + scopes
  const [minutes, setMinutes] = useState(15);
  const [wpm, setWpm] = useState(40);
  const [scopePw, setScopePw] = useState("");
  const [companyCanon, setCompanyCanon] = useState("");
  const [exampleBusy, setExampleBusy] = useState(false);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  /** Populate every field from a generated example draft, for tweaking before launch. */
  function applyDraft(d: ScenarioDraft) {
    setRole(d.role);
    setReports(d.reports.length ? d.reports : [blankReport()]);
    setOpeningSituation(d.opening_situation);
    setOpeningMessage(d.opening_message);
    setEndState(d.end_state_note);
    setObjectives(d.objectives.length ? d.objectives : [{ id: uid(), label: "", success_signal: "", weight: 3 }]);
    setCompanyCanon((d.company_canon ?? []).join("\n"));
    setMinutes(d.minutes ?? 15);
  }

  const setReport = (id: string, patch: Partial<ReportSpec>) =>
    setReports((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  async function extractRoleFromJD() {
    if (!roleJD.trim()) return;
    setExtractingRole(true); setErr("");
    try { setRole(await api.extractRole(roleJD.trim())); }
    catch (e: any) { setErr(e.message); }
    finally { setExtractingRole(false); }
  }

  async function seedReportFromJD(id: string, jd: string) {
    if (!jd.trim()) return;
    try {
      const seed = await api.extractReport(jd.trim());
      setReport(id, seed);
    } catch (e: any) { setErr(e.message); }
  }

  async function create() {
    setErr("");
    if (!role.title.trim()) return setErr("Give the role a title (or extract one from a JD).");
    if (!reports.some((r) => r.name.trim())) return setErr("Add at least one named report.");
    if (!openingMessage.trim()) return setErr("Write the opening message the candidate will see.");
    setBusy(true);
    try {
      const created = await api.buildInterview({
        role,
        reports: reports.filter((r) => r.name.trim()),
        opening_message: openingMessage.trim(),
        opening_situation: openingSituation.trim(),
        end_state_note: endState.trim(),
        objectives: objectives.filter((o) => o.label.trim()),
        minutes, assumed_wpm: wpm,
        scope_password: scopePw.trim() || undefined,
        company_canon: companyCanon.split("\n").map((l) => l.trim()).filter(Boolean),
      });
      onCreated(created.id);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="h-full overflow-y-auto px-5 sm:px-8 py-6 max-w-2xl mx-auto">
      <div className="font-display text-lg mb-1">New interview assessment</div>
      <div className="text-[13px] mb-4" style={{ color: "var(--text-mid)" }}>
        Everything here is fixed once the scenario starts, so every candidate faces the identical setup. The clock starts the moment the candidate begins their first response and ends at the boundary — it can't be bypassed.
      </div>

      {/* quick test: generate a complete example scenario into the form to tweak */}
      <div className="mb-6 rounded-lg p-3.5 flex items-center justify-between gap-3" style={{ background: "var(--surface-2)", border: "1px dashed var(--border)" }}>
        <div className="text-[12.5px]" style={{ color: "var(--text-mid)" }}>
          Need a starting point? Generate a complete example — cast, situation, objectives — into the form below, then tweak anything before you launch.
        </div>
        <button onClick={async () => {
          setErr(""); setExampleBusy(true);
          try { const d = await api.draftExample(roleJD.trim() || undefined, minutes); applyDraft(d); }
          catch (e: any) { setErr(e.message); }
          finally { setExampleBusy(false); }
        }} disabled={exampleBusy}
          className="shrink-0 px-3.5 py-2 rounded-lg text-[13px] font-display whitespace-nowrap"
          style={{ background: "var(--accent)", color: "var(--bg)" }}>
          {exampleBusy ? "Generating…" : "Fill with example"}
        </button>
      </div>

      {/* ROLE */}
      <Section title="The role being assessed">
        <label className={lbl} style={lblStyle}>Paste a job description (optional — extracts the role)</label>
        <textarea value={roleJD} onChange={(e) => setRoleJD(e.target.value)} rows={3} className="w-full rounded-lg p-2.5 text-[13px] mb-2" style={field} placeholder="Paste the manager job description; we'll extract title, level, and key competencies." />
        <button onClick={extractRoleFromJD} disabled={extractingRole || !roleJD.trim()} className="text-[12px] px-3 py-1.5 rounded-md mb-3" style={field}>
          {extractingRole ? "Extracting…" : "Extract role from JD"}
        </button>
        <label className={lbl} style={lblStyle}>Role title</label>
        <input value={role.title} onChange={(e) => setRole({ ...role, title: e.target.value })} className="w-full rounded-lg p-2.5 text-[14px] mb-3" style={field} placeholder="e.g. Engineering Team Lead" />
        <label className={lbl} style={lblStyle}>Level</label>
        <div className="grid grid-cols-1 gap-1.5 mb-3">
          {LEVELS.map((l) => (
            <button key={l} onClick={() => setRole({ ...role, level: l })} className="text-left rounded-lg p-2.5 text-[13px]" style={{ ...field, borderColor: role.level === l ? "var(--accent, #6aa67a)" : "var(--border, rgba(255,255,255,0.08))" }}>
              {LEVEL_LABEL[l]}
            </button>
          ))}
        </div>
        <label className={lbl} style={lblStyle}>Role summary</label>
        <textarea value={role.summary} onChange={(e) => setRole({ ...role, summary: e.target.value })} rows={2} className="w-full rounded-lg p-2.5 text-[13px]" style={field} placeholder="Scope and responsibilities of the manager role." />
      </Section>

      {/* REPORTS */}
      <Section title="The team they'll manage">
        {reports.map((r, i) => (
          <div key={r.id} className="rounded-lg p-3 mb-3" style={{ background: "var(--surface-2, rgba(255,255,255,0.05))", border: "1px solid var(--border, rgba(255,255,255,0.07))" }}>
            <div className="flex items-center justify-between mb-2">
              <div className="font-display text-[13px]">Report {i + 1}</div>
              {reports.length > 1 && <button onClick={() => setReports((rs) => rs.filter((x) => x.id !== r.id))} className="text-[12px]" style={{ color: "#c07a6a" }}>remove</button>}
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input value={r.name} onChange={(e) => setReport(r.id, { name: e.target.value })} className="rounded-lg p-2 text-[13px]" style={field} placeholder="Name" />
              <input value={r.role_title} onChange={(e) => setReport(r.id, { role_title: e.target.value })} className="rounded-lg p-2 text-[13px]" style={field} placeholder="Job title" />
            </div>
            <details className="mb-2">
              <summary className="text-[12px] cursor-pointer" style={{ color: "var(--text-mid)" }}>Seed this report from a job description</summary>
              <ReportJDSeed onSeed={(jd) => seedReportFromJD(r.id, jd)} />
            </details>
            <input value={r.experience} onChange={(e) => setReport(r.id, { experience: e.target.value })} className="w-full rounded-lg p-2 text-[13px] mb-2" style={field} placeholder="Experience (e.g. 8 years, 3 on this team)" />
<input 
  value={r.personality_traits.join(", ")} 
  onChange={(e) => {
    const val = e.target.value;
    // Split by comma, keep the raw parts so trailing commas/spaces stay alive in the input field
    const traits = val.split(",").map((s) => s.trimStart()); // leaves trailing spaces alone
    setReport(r.id, { personality_traits: traits });
  }} 
  className="w-full rounded-lg p-2 text-[13px] mb-2" 
  style={field} 
  placeholder="Personality traits, comma-separated (e.g. blunt, perfectionist, resents the reorg)" 
/>
            <textarea value={r.disposition_to_manager} onChange={(e) => setReport(r.id, { disposition_to_manager: e.target.value })} rows={2} className="w-full rounded-lg p-2 text-[13px] mb-2" style={field} placeholder="Disposition toward a new manager — including any authored friction and its reason (e.g. 'skeptical; was passed over for the lead role')" />
            <textarea value={r.hidden_driver} onChange={(e) => setReport(r.id, { hidden_driver: e.target.value })} rows={2} className="w-full rounded-lg p-2 text-[13px] mb-2" style={field} placeholder="Hidden driver — what they really want or fear (surfaced only if the candidate diagnoses well; not stated outright)" />
            <div className="flex gap-4 items-center mb-2 text-[12px]" style={{ color: "var(--text-mid)" }}>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!r.is_lead} onChange={(e) => setReport(r.id, { is_lead: e.target.checked })} />manages others (a lead)</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!r.is_high_performer} onChange={(e) => setReport(r.id, { is_high_performer: e.target.checked })} />high performer</label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-[10px]" style={lblStyle}>Starting warmth ({r.starting_warmth})</label><input type="range" min={-100} max={100} value={r.starting_warmth} onChange={(e) => setReport(r.id, { starting_warmth: Number(e.target.value) })} className="w-full" /></div>
              <div><label className="text-[10px]" style={lblStyle}>Starting trust ({r.starting_trust})</label><input type="range" min={-100} max={100} value={r.starting_trust} onChange={(e) => setReport(r.id, { starting_trust: Number(e.target.value) })} className="w-full" /></div>
            </div>
          </div>
        ))}
        <button onClick={() => setReports((rs) => [...rs, blankReport()])} className="text-[12px] px-3 py-1.5 rounded-md" style={field}>+ add report</button>
      </Section>

      {/* SCENARIO */}
      <Section title="The scenario">
        <label className={lbl} style={lblStyle}>Situation framing (what the candidate is told going in)</label>
        <textarea value={openingSituation} onChange={(e) => setOpeningSituation(e.target.value)} rows={2} className="w-full rounded-lg p-2.5 text-[13px] mb-3" style={field} placeholder="You're newly leading this team. An escalated feature is due Friday and the team is at odds over how to ship it." />
        <label className={lbl} style={lblStyle}>Opening message (the literal first message the candidate sees)</label>
        <textarea value={openingMessage} onChange={(e) => setOpeningMessage(e.target.value)} rows={3} className="w-full rounded-lg p-2.5 text-[13px] mb-3" style={field} placeholder="The exact scene/message that opens the assessment — the clock starts when they reply to this." />
        <label className={lbl} style={lblStyle}>End-state (fixed; the candidate can't bypass it)</label>
        <textarea value={endState} onChange={(e) => setEndState(e.target.value)} rows={2} className="w-full rounded-lg p-2.5 text-[13px]" style={field} placeholder="What 'the scenario is over' means — e.g. 'The standup ends and the ship/no-ship call must be made.'" />
        <label className={lbl + " mt-3"} style={lblStyle}>Internal company facts (one per line, optional)</label>
        <textarea value={companyCanon} onChange={(e) => setCompanyCanon(e.target.value)} rows={3} className="w-full rounded-lg p-2.5 text-[13px]" style={field} placeholder={"Things the AI couldn't know but the team treats as normal. One per line, e.g.:\nThe on-call contractor only answers a specific line and there's a ~12-minute response delay.\nProduction deploys require two approvals and the release window is Tuesdays only."} />
        <div className="text-[11px] mt-1.5" style={{ color: "var(--text-lo)" }}>
          These become world facts every character honors. They shape the situation but aren't part of the grading rubric — a candidate isn't marked down for not knowing one unless the scenario surfaces it.
        </div>
      </Section>

      {/* OBJECTIVES */}
      <Section title="Objectives (graded against outcomes)">
        {objectives.map((o) => (
          <div key={o.id} className="rounded-lg p-2.5 mb-2" style={{ background: "var(--surface-2, rgba(255,255,255,0.05))" }}>
            <input value={o.label} onChange={(e) => setObjectives((os) => os.map((x) => x.id === o.id ? { ...x, label: e.target.value } : x))} className="w-full rounded-md p-2 text-[13px] mb-1.5" style={field} placeholder="Objective (e.g. keep the high performer engaged)" />
            <input value={o.success_signal} onChange={(e) => setObjectives((os) => os.map((x) => x.id === o.id ? { ...x, success_signal: e.target.value } : x))} className="w-full rounded-md p-2 text-[12px]" style={field} placeholder="Observable success signal (e.g. their drive doesn't drift toward leaving)" />
          </div>
        ))}
        <button onClick={() => setObjectives((os) => [...os, { id: uid(), label: "", success_signal: "", weight: 3 }])} className="text-[12px] px-3 py-1.5 rounded-md" style={field}>+ add objective</button>
      </Section>

      {/* TIMING + SCOPES */}
      <Section title="Clock & reviewer scopes">
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className={lbl} style={lblStyle}>Total time (minutes)</label>
            <input type="number" min={1} max={120} value={minutes} onChange={(e) => setMinutes(Math.max(1, Math.min(120, Number(e.target.value) || 15)))} className="w-full rounded-lg p-2.5 text-[14px]" style={field} />
          </div>
          <div>
            <label className={lbl} style={lblStyle}>Typing baseline (WPM)</label>
            <input type="number" min={10} max={120} value={wpm} onChange={(e) => setWpm(Math.max(10, Math.min(120, Number(e.target.value) || 40)))} className="w-full rounded-lg p-2.5 text-[14px]" style={field} />
          </div>
        </div>
        <div className="text-[11px] mb-3" style={{ color: "var(--text-mid)" }}>
          The typing baseline only sets a length-adjusted expectation so pacing can be read as pressure-handling — pausing to think before replying is treated as a positive signal, and slow typing is never penalized.
        </div>
        <label className={lbl} style={lblStyle}>Reviewer-scope password (optional)</label>
        <input type="password" value={scopePw} onChange={(e) => setScopePw(e.target.value)} className="w-full rounded-lg p-2.5 text-[14px]" style={field} placeholder="Set a password to unlock the reviewer-only scopes (the reports' hidden state)" />
        <div className="text-[11px] mt-1.5" style={{ color: "var(--text-mid)" }}>
          Scopes reveal each report's internal state. They are gated behind this password and a toggle, and are never shown to the candidate during a scored run. The password is hashed at creation and not stored in plaintext — keep it safe; it can't be recovered.
        </div>
      </Section>

      {err && <div className="text-[13px] my-3" style={{ color: "#c07a6a" }}>{err}</div>}
      <button onClick={create} disabled={busy} className="px-4 py-2.5 rounded-lg font-display text-[14px] mb-12 mt-2" style={{ background: "var(--accent, #6aa67a)", color: "var(--bg, #111)" }}>
        {busy ? "Building…" : "Create assessment"}
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-7">
      <div className="font-display text-[13px] uppercase tracking-wide mb-3" style={{ color: "var(--text-mid)" }}>{title}</div>
      {children}
    </div>
  );
}

function ReportJDSeed({ onSeed }: { onSeed: (jd: string) => void }) {
  const [jd, setJd] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-2">
      <textarea value={jd} onChange={(e) => setJd(e.target.value)} rows={3} className="w-full rounded-lg p-2 text-[12px] mb-1.5" style={field} placeholder="Paste this person's job description; we'll seed a neutral professional baseline (you add the personality)." />
      <button onClick={async () => { setBusy(true); await onSeed(jd); setBusy(false); }} disabled={busy || !jd.trim()} className="text-[12px] px-2.5 py-1 rounded-md" style={field}>
        {busy ? "Seeding…" : "Seed from JD"}
      </button>
    </div>
  );
}
