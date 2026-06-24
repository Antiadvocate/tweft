import React, { useState } from "react";
import { motion } from "motion/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { InterviewReport, CompetencyScore, InterviewConfig, Grade, DecisiveMoment } from "../engine/interview-types";
import { GRADE_MEANING } from "../engine/interview-types";
import type { ClientSave } from "../lib/api";
import { api } from "../lib/api";

const GRADE_COLOR: Record<Grade, string> = {
  A: "var(--accent, #6aa67a)",
  B: "#7fae8a",
  C: "#c8a35a",
  D: "#c07a6a",
};
function gradeBg(g: Grade) { return `${GRADE_COLOR[g]}22`; }

/** big letter badge */
function GradeBadge({ grade, size = 72 }: { grade: Grade; size?: number }) {
  return (
    <div className="flex items-center justify-center rounded-2xl font-display"
      style={{ width: size, height: size, background: gradeBg(grade), color: GRADE_COLOR[grade], fontSize: size * 0.5, lineHeight: 1, border: `2px solid ${GRADE_COLOR[grade]}` }}>
      {grade}
    </div>
  );
}

/** small grade pill */
function GradePill({ grade }: { grade: Grade }) {
  return (
    <span className="inline-flex items-center justify-center rounded-md font-display text-[12px]"
      style={{ width: 22, height: 22, background: gradeBg(grade), color: GRADE_COLOR[grade], border: `1px solid ${GRADE_COLOR[grade]}` }}>
      {grade}
    </span>
  );
}

/** ───────────────── infographic: competency profile as a compact bar row ───────────────── */
function CompetencyProfile({ spine }: { spine: CompetencyScore[] }) {
  const gradeVal: Record<Grade, number> = { A: 100, B: 75, C: 50, D: 28 };
  return (
    <div className="grid grid-cols-1 gap-1.5">
      {spine.map((c) => (
        <div key={c.competency} className="flex items-center gap-2.5">
          <div className="text-[12px] w-40 shrink-0 truncate" style={{ color: "var(--text-mid)" }}>{c.label}</div>
          <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: "var(--surface-2, rgba(255,255,255,0.06))" }}>
            <motion.div initial={{ width: 0 }} animate={{ width: `${gradeVal[c.grade]}%` }} transition={{ duration: 0.5, ease: "easeOut" }}
              className="h-full rounded-full" style={{ background: GRADE_COLOR[c.grade] }} />
          </div>
          <div className="shrink-0"><GradePill grade={c.grade} /></div>
        </div>
      ))}
    </div>
  );
}

/** ───────────────── decisive moments (literal actions) ───────────────── */
function DecisiveMoments({ moments }: { moments: DecisiveMoment[] }) {
  if (!moments.length) return null;
  return (
    <div className="grid grid-cols-1 gap-2">
      {moments.map((m, i) => {
        const strong = m.kind === "strong";
        const color = strong ? "var(--accent, #6aa67a)" : "#c07a6a";
        return (
          <div key={i} className="rounded-lg p-3" style={{ background: "var(--surface-1, rgba(255,255,255,0.03))", borderLeft: `3px solid ${color}` }}>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-[11px] px-1.5 py-0.5 rounded" style={{ background: `${color}22`, color }}>T{m.turn}</span>
              <span className="text-[11px] uppercase tracking-wide" style={{ color }}>{strong ? "strong move" : "costly move"}</span>
            </div>
            <div className="text-[13.5px] leading-snug">{m.action}</div>
            <div className="text-[12.5px] mt-1" style={{ color: "var(--text-mid)" }}>→ {m.consequence}</div>
          </div>
        );
      })}
    </div>
  );
}

function StyleAxis({ left, right, value }: { left: string; right: string; value: number }) {
  return (
    <div className="mb-3">
      <div className="flex justify-between text-[11px] mb-1" style={{ color: "var(--text-mid)" }}><span>{left}</span><span>{right}</span></div>
      <div className="relative h-2 rounded-full" style={{ background: "var(--surface-2, rgba(255,255,255,0.06))" }}>
        <motion.div initial={{ left: "50%" }} animate={{ left: `${value}%` }} transition={{ duration: 0.6 }} className="absolute top-1/2 w-3 h-3 rounded-full -translate-x-1/2 -translate-y-1/2" style={{ background: "var(--text-hi, #c9c4b8)", boxShadow: "0 0 0 3px var(--bg, #111)" }} />
      </div>
    </div>
  );
}

/** ───────────────── per-competency detail card ───────────────── */
const CompCard: React.FC<{ c: CompetencyScore }> = ({ c }) => {
  return (
    <div className="rounded-lg p-3.5" style={{ background: "var(--surface-1, rgba(255,255,255,0.03))", border: "1px solid var(--border, rgba(255,255,255,0.07))" }}>
      <div className="flex items-center justify-between mb-2">
        <div className="font-display text-[14px]">{c.label}</div>
        <GradePill grade={c.grade} />
      </div>
      {c.evidence && <div className="text-[12.5px] mb-2" style={{ color: "var(--text-mid)" }}>{c.evidence}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {c.what_worked && <div className="text-[12px]"><span style={{ color: "var(--accent, #6aa67a)" }}>Worked — </span><span style={{ color: "var(--text-mid)" }}>{c.what_worked}</span></div>}
        {c.what_to_change && <div className="text-[12px]"><span style={{ color: "#c8a35a" }}>Change — </span><span style={{ color: "var(--text-mid)" }}>{c.what_to_change}</span></div>}
      </div>
      {c.state_note && <div className="text-[11px] mt-2" style={{ color: "var(--text-low, var(--text-mid))" }}>↳ {c.state_note}</div>}
    </div>
  );
};

/** ───────────────── full transcript ───────────────── */
function Transcript({ save }: { save: ClientSave }) {
  const [open, setOpen] = useState(false);
  const turns = save.history.filter((h: any) => h.kind !== "opening" || h.narrator_prose);
  return (
    <div className="mt-7 no-print">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 font-display text-[13px] uppercase tracking-wide" style={{ color: "var(--text-mid)" }}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Full transcript ({save.history.filter((h:any)=>h.player_action).length} responses)
      </button>
      {open && (
        <div className="mt-3 rounded-lg p-4" style={{ background: "var(--surface-1, rgba(255,255,255,0.03))", border: "1px solid var(--border, rgba(255,255,255,0.07))" }}>
          {save.interview?.opening_message && (
            <div className="text-[13px] mb-4 pb-3" style={{ borderBottom: "1px solid var(--border)", color: "var(--text-mid)" }}>
              {save.interview.opening_message}
            </div>
          )}
          {turns.map((h: any, i: number) => (
            <div key={i} className="mb-4">
              {h.player_action && (
                <div className="mb-2">
                  <span className="text-[11px] uppercase tracking-wide font-mono" style={{ color: "var(--accent, #6aa67a)" }}>Candidate (T{h.turn})</span>
                  <div className="text-[13.5px] mt-0.5">{h.player_action}</div>
                </div>
              )}
              {h.narrator_prose && (
                <div className="text-[13.5px] leading-relaxed" style={{ color: "var(--text-mid)" }}>
                  {h.narrator_prose.split(/\n{2,}/).map((p: string, j: number) => <p key={j} className="mb-1.5">{p}</p>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** ───────────────── password-gated reviewer scopes ───────────────── */
function ScopesPanel({ save }: { save: ClientSave }) {
  const cfg = save.interview as InterviewConfig | undefined;
  const [pw, setPw] = useState("");
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const [checking, setChecking] = useState(false);
  if (!cfg?.scopes?.enabled) return null;

  async function unlock() {
    setChecking(true); setErr("");
    try { const ok = await api.verifyScopes(save.id, pw); if (ok) setOpen(true); else setErr("Incorrect password."); }
    catch (e: any) { setErr(e.message); }
    finally { setChecking(false); }
  }

  return (
    <div className="mt-7 rounded-lg p-4 no-print" style={{ background: "var(--surface-1, rgba(255,255,255,0.03))", border: "1px dashed var(--border, rgba(255,255,255,0.12))" }}>
      <div className="text-[11px] uppercase tracking-wide mb-2" style={{ color: "var(--text-mid)" }}>Reviewer scopes (password-gated)</div>
      {!open ? (
        <div className="flex items-center gap-2">
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && unlock()} placeholder="Reviewer password" className="flex-1 rounded-lg p-2 text-[13px]" style={{ background: "var(--surface-2, rgba(255,255,255,0.05))", border: "1px solid var(--border, rgba(255,255,255,0.08))" }} />
          <button onClick={unlock} disabled={checking || !pw} className="px-3 py-2 rounded-lg text-[13px]" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>{checking ? "…" : "Unlock"}</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {Object.entries(save.characters).filter(([id]) => id !== "char_player").map(([id, c]: any) => {
            const cond = save.condition[id];
            const edge = save.world.edges.find((e: any) => e.from === id && e.to === "char_player");
            const drive = save.characters[id]?.drive;
            const belief = (save as any).minds?.[id]?.about?.find((b: any) => b.target === "char_player");
            const trueWarmth = edge?.warmth ?? 0;
            const gap = belief ? Math.abs(trueWarmth - belief.predicted_warmth) : 0;
            const readNote = belief && (belief.held_false || gap > 20 || belief.surprise > 0.4)
              ? (belief.held_false ? `carries a misread — wrongly ${String(belief.held_false).replace(/^is /, "")}`
                : gap > 20 ? `misreads you (${Math.round(gap)} pts off)` : "freshly thrown by something you did")
              : belief ? "reads you accurately" : null;
            return (
              <div key={id} className="rounded-md p-2.5 text-[12.5px]" style={{ background: "var(--surface-2, rgba(255,255,255,0.05))" }}>
                <span className="font-display">{c.name}</span>
                <span style={{ color: "var(--text-mid)" }}> — mood {cond?.psyche?.mood ?? "—"} (relaxation {cond?.psyche?.relaxation ?? 0}); warmth {edge?.warmth ?? 0}, trust {edge?.trust ?? 0}{drive?.goal ? `; still wants: ${drive.goal}` : ""}</span>
                {readNote && <div className="mt-1 text-[11.5px]" style={{ color: readNote.startsWith("reads you accurately") ? "var(--text-low, var(--text-mid))" : "#c8a35a" }}>↳ their read of you: {readNote}</div>}
              </div>
            );
          })}
        </div>
      )}
      {err && <div className="text-[12px] mt-2" style={{ color: "#c07a6a" }}>{err}</div>}
    </div>
  );
}

export default function InterviewReportView({ report, save, onClose }: { report: InterviewReport; save: ClientSave; onClose?: () => void }) {
  const r = report;
  const objMet = r.objectives.filter((o) => o.met).length;
  return (
    <div className="h-full overflow-y-auto px-5 sm:px-8 py-6 max-w-3xl mx-auto print-area">

      {/* ═══════════ INFOGRAPHIC: at-a-glance ═══════════ */}
      <div className="text-[11px] uppercase tracking-wide mb-3" style={{ color: "var(--text-mid)" }}>
        Assessment · {r.role_title} · {r.level.replace(/_/g, " ")}
      </div>

      <div className="rounded-2xl p-5 mb-5" style={{ background: "var(--surface-1, rgba(255,255,255,0.03))", border: "1px solid var(--border, rgba(255,255,255,0.08))" }}>
        <div className="flex items-start gap-4 mb-4">
          <GradeBadge grade={r.overall_grade} />
          <div className="flex-1">
            <div className="font-display text-[15px] leading-tight mb-0.5">{GRADE_MEANING[r.overall_grade]}</div>
            <div className="text-[13px]" style={{ color: "var(--text-mid)" }}>{r.summary}</div>
          </div>
        </div>

        {/* objectives strip */}
        {r.objectives.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {r.objectives.map((o) => (
              <div key={o.id} className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px]"
                style={{ background: o.met ? "rgba(106,166,122,0.12)" : "rgba(192,122,106,0.12)", border: `1px solid ${o.met ? "rgba(106,166,122,0.4)" : "rgba(192,122,106,0.4)"}` }}>
                <span style={{ color: o.met ? "var(--accent, #6aa67a)" : "#c07a6a" }}>{o.met ? "✓" : "✕"}</span>
                <span>{o.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* competency profile */}
        <CompetencyProfile spine={r.spine} />
      </div>

      {/* ═══════════ what they actually did ═══════════ */}
      {r.decisive_moments.length > 0 && (
        <>
          <div className="mb-2 font-display text-[13px] uppercase tracking-wide" style={{ color: "var(--text-mid)" }}>What they actually did</div>
          <div className="mb-6"><DecisiveMoments moments={r.decisive_moments} /></div>
        </>
      )}

      {/* ═══════════ for the hiring decision ═══════════ */}
      {r.hiring_actionable.length > 0 && (
        <div className="mb-6 rounded-lg p-4" style={{ background: "var(--surface-2, rgba(255,255,255,0.05))", border: "1px solid var(--border, rgba(255,255,255,0.08))" }}>
          <div className="mb-2.5 font-display text-[13px] uppercase tracking-wide" style={{ color: "var(--text-hi, #c9c4b8)" }}>For the hiring decision</div>
          <ul className="space-y-1.5">
            {r.hiring_actionable.map((h, i) => (
              <li key={i} className="text-[13.5px] flex gap-2"><span style={{ color: "var(--accent, #6aa67a)" }}>•</span><span>{h}</span></li>
            ))}
          </ul>
        </div>
      )}

      {/* ═══════════ competency detail ═══════════ */}
      <div className="mb-2 font-display text-[13px] uppercase tracking-wide" style={{ color: "var(--text-mid)" }}>Competency detail</div>
      <div className="grid grid-cols-1 gap-2.5 mb-2">{r.spine.map((c) => <CompCard key={c.competency} c={c} />)}</div>

      {/* style */}
      <div className="mt-7 mb-2 font-display text-[13px] uppercase tracking-wide" style={{ color: "var(--text-mid)" }}>Management style</div>
      <div className="rounded-lg p-4" style={{ background: "var(--surface-1, rgba(255,255,255,0.03))", border: "1px solid var(--border, rgba(255,255,255,0.07))" }}>
        <StyleAxis left="Directive" right="Participative" value={r.style.directive_participative} />
        <StyleAxis left="Task focus" right="Relationship focus" value={r.style.task_relationship} />
        <div className="text-[13px] mt-2"><span className="font-display">{r.style.primary_style}</span><span style={{ color: "var(--text-mid)" }}> under normal conditions.</span></div>
        {r.style.pressure_shift_note && <div className="text-[13px] mt-1.5" style={{ color: "var(--text-mid)" }}>Under pressure → <span style={{ color: "var(--text-hi, #c9c4b8)" }}>{r.style.under_pressure_style}</span>: {r.style.pressure_shift_note}</div>}
        {r.style.fit_read && <div className="text-[12.5px] mt-3 pt-3" style={{ borderTop: "1px solid var(--border, rgba(255,255,255,0.07))", color: "var(--text-mid)" }}><span style={{ color: "var(--text-hi, #c9c4b8)" }}>Fit to this role & team: </span>{r.style.fit_read}</div>}
      </div>

      {/* composure + timing */}
      <div className="mt-7 mb-2 font-display text-[13px] uppercase tracking-wide" style={{ color: "var(--text-mid)" }}>Composure under pressure</div>
      <div className="rounded-lg p-4 text-[13px]" style={{ background: "var(--surface-1, rgba(255,255,255,0.03))", border: "1px solid var(--border, rgba(255,255,255,0.07))" }}>
        <div>{r.pressure.composure_read}</div>
        {r.pressure.breather_use && <div className="mt-1.5" style={{ color: "var(--text-mid)" }}>Breather use: {r.pressure.breather_use}</div>}
        <div className="mt-2 pt-2 text-[12.5px]" style={{ borderTop: "1px solid var(--border, rgba(255,255,255,0.07))", color: "var(--text-mid)" }}>{r.timing_summary}</div>
        {r.pressure.rushed_under_tension && <div className="mt-1.5 text-[12px]" style={{ color: "#c8a35a" }}>⚠ Pace collapsed when pressure spiked — fired back rather than taking a beat.</div>}
      </div>

      {/* relationship deltas */}
      {r.relationship_deltas.length > 0 && (
        <>
          <div className="mt-7 mb-2 font-display text-[13px] uppercase tracking-wide" style={{ color: "var(--text-mid)" }}>How each relationship moved</div>
          <div className="grid grid-cols-1 gap-1.5">
            {r.relationship_deltas.map((d) => (
              <div key={d.report_id} className="rounded-lg px-3 py-2 text-[13px] flex items-center gap-3" style={{ background: "var(--surface-1, rgba(255,255,255,0.03))" }}>
                <span className="font-display shrink-0 w-24 truncate">{d.name}</span>
                <span className="font-mono text-[12px] shrink-0" style={{ color: d.warmth_delta >= 0 ? "var(--accent, #6aa67a)" : "#c07a6a" }}>w{d.warmth_delta >= 0 ? "+" : ""}{d.warmth_delta}</span>
                <span className="font-mono text-[12px] shrink-0" style={{ color: d.trust_delta >= 0 ? "var(--accent, #6aa67a)" : "#c07a6a" }}>t{d.trust_delta >= 0 ? "+" : ""}{d.trust_delta}</span>
                <span style={{ color: "var(--text-mid)" }} className="truncate">{d.read}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* missed signals */}
      {r.missed_signals.length > 0 && (
        <div className="mt-7">
          <div className="mb-2 font-display text-[13px] uppercase tracking-wide" style={{ color: "var(--text-mid)" }}>Signals not surfaced</div>
          <ul className="space-y-1">{r.missed_signals.map((m, i) => <li key={i} className="text-[13px] pl-3" style={{ color: "var(--text-mid)", borderLeft: "2px solid #c8a35a" }}>{m}</li>)}</ul>
        </div>
      )}

      {/* reviewer paragraph */}
      {r.reviewer_note && (
        <div className="mt-7 rounded-lg p-4" style={{ background: "var(--surface-2, rgba(255,255,255,0.05))", border: "1px solid var(--border, rgba(255,255,255,0.07))" }}>
          <div className="text-[11px] uppercase tracking-wide mb-2" style={{ color: "var(--text-mid)" }}>Reviewer summary</div>
          <div className="text-[13.5px] leading-relaxed">{r.reviewer_note}</div>
        </div>
      )}

      {/* transcript */}
      <Transcript save={save} />

      {/* scopes */}
      <ScopesPanel save={save} />

      {/* decision-support guardrail */}
      <div className="mt-7 rounded-lg p-3.5 text-[12px] leading-relaxed" style={{ background: "rgba(192,122,106,0.08)", border: "1px solid rgba(192,122,106,0.3)", color: "var(--text-mid)" }}>
        {r.decision_support_notice}
      </div>

      <div className="flex items-center gap-3 mt-6 mb-12 no-print">
        <button onClick={() => window.print()} className="px-4 py-2 rounded-lg text-[13px] font-display" style={{ background: "var(--accent, #6aa67a)", color: "var(--bg, #111)" }}>Save as PDF</button>
        {onClose && <button onClick={onClose} className="px-4 py-2 rounded-lg text-[13px]" style={{ background: "var(--surface-1, rgba(255,255,255,0.04))", border: "1px solid var(--border, rgba(255,255,255,0.08))" }}>Back</button>}
      </div>
    </div>
  );
}
