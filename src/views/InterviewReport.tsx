import React, { useState } from "react";
import { motion } from "motion/react";
import type { InterviewReport, CompetencyScore, InterviewConfig } from "../engine/interview-types";
import type { ClientSave } from "../lib/api";
import { api } from "../lib/api";

function scoreColor(v: number): string {
  if (v >= 78) return "var(--accent, #6aa67a)";
  if (v >= 58) return "var(--text-hi, #c9c4b8)";
  if (v >= 40) return "#c8a35a";
  return "#c07a6a";
}

function Bar({ value }: { value: number }) {
  return (
    <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--surface-2, rgba(255,255,255,0.06))" }}>
      <motion.div initial={{ width: 0 }} animate={{ width: `${value}%` }} transition={{ duration: 0.6, ease: "easeOut" }} className="h-full rounded-full" style={{ background: scoreColor(value) }} />
    </div>
  );
}

const CompCard: React.FC<{ c: CompetencyScore }> = ({ c }) => {
  return (
    <div className="rounded-lg p-3.5" style={{ background: "var(--surface-1, rgba(255,255,255,0.03))", border: "1px solid var(--border, rgba(255,255,255,0.07))" }}>
      <div className="flex items-baseline justify-between mb-1.5">
        <div className="font-display text-[14px]">{c.label}</div>
        <div className="font-mono text-[15px]" style={{ color: scoreColor(c.score) }}>{c.score}</div>
      </div>
      <Bar value={c.score} />
      {c.anchor_matched && <div className="text-[11px] mt-2 italic" style={{ color: "var(--text-mid)" }}>matched: {c.anchor_matched}</div>}
      {c.evidence && <div className="text-[12.5px] mt-1.5" style={{ color: "var(--text-mid)" }}>{c.evidence}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2.5">
        {c.what_worked && <div className="text-[12px]"><span style={{ color: "var(--accent, #6aa67a)" }}>Worked — </span><span style={{ color: "var(--text-mid)" }}>{c.what_worked}</span></div>}
        {c.what_to_change && <div className="text-[12px]"><span style={{ color: "#c8a35a" }}>Change — </span><span style={{ color: "var(--text-mid)" }}>{c.what_to_change}</span></div>}
      </div>
      {c.state_note && <div className="text-[11px] mt-2" style={{ color: "var(--text-low, var(--text-mid))" }}>↳ {c.state_note}</div>}
    </div>
  );
};

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

/** Password-gated panel revealing the reports' hidden internal state. */
function ScopesPanel({ save }: { save: ClientSave }) {
  const cfg = save.interview as InterviewConfig | undefined;
  const [pw, setPw] = useState("");
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const [checking, setChecking] = useState(false);

  if (!cfg?.scopes?.enabled) return null;

  async function unlock() {
    setChecking(true); setErr("");
    try {
      const ok = await api.verifyScopes(save.id, pw);
      if (ok) setOpen(true); else setErr("Incorrect password.");
    } catch (e: any) { setErr(e.message); }
    finally { setChecking(false); }
  }

  return (
    <div className="mt-7 rounded-lg p-4" style={{ background: "var(--surface-1, rgba(255,255,255,0.03))", border: "1px dashed var(--border, rgba(255,255,255,0.12))" }}>
      <div className="text-[11px] uppercase tracking-wide mb-2" style={{ color: "var(--text-mid)" }}>Reviewer scopes (password-gated)</div>
      {!open ? (
        <div className="flex items-center gap-2">
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && unlock()} placeholder="Reviewer password" className="flex-1 rounded-lg p-2 text-[13px]" style={{ background: "var(--surface-2, rgba(255,255,255,0.05))", border: "1px solid var(--border, rgba(255,255,255,0.08))" }} />
          <button onClick={unlock} disabled={checking || !pw} className="px-3 py-2 rounded-lg text-[13px]" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>{checking ? "…" : "Unlock"}</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {Object.entries(save.characters).filter(([id]) => id !== "char_player").map(([id, c]) => {
            const cond = save.condition[id];
            const edge = save.world.edges.find((e) => e.from === id && e.to === "char_player");
            const drive = save.characters[id]?.drive;
            return (
              <div key={id} className="rounded-md p-2.5 text-[12.5px]" style={{ background: "var(--surface-2, rgba(255,255,255,0.05))" }}>
                <span className="font-display">{c.name}</span>
                <span style={{ color: "var(--text-mid)" }}> — mood {cond?.psyche?.mood ?? "—"} (relaxation {cond?.psyche?.relaxation ?? 0}); warmth {edge?.warmth ?? 0}, trust {edge?.trust ?? 0}{drive?.goal ? `; still wants: ${drive.goal}` : ""}</span>
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
  return (
    <div className="h-full overflow-y-auto px-5 sm:px-8 py-6 max-w-3xl mx-auto">
      <div className="text-[11px] uppercase tracking-wide mb-1.5" style={{ color: "var(--text-mid)" }}>
        Assessment · {r.role_title} · {r.level.replace(/_/g, " ")}
      </div>
      <div className="font-display text-[20px] leading-snug mb-3">{r.summary}</div>
      <div className="flex items-center gap-3 mb-1">
        <div className="font-mono text-[28px]" style={{ color: scoreColor(r.overall) }}>{r.overall}</div>
        <div className="text-[12px]" style={{ color: "var(--text-mid)" }}>composite across eight competencies — evidence for a reviewer, not a hire/no-hire score</div>
      </div>

      <div className="mt-6 mb-2 font-display text-[13px] uppercase tracking-wide" style={{ color: "var(--text-mid)" }}>Competencies</div>
      <div className="grid grid-cols-1 gap-2.5">{r.spine.map((c) => <CompCard key={c.competency} c={c} />)}</div>

      <div className="mt-7 mb-2 font-display text-[13px] uppercase tracking-wide" style={{ color: "var(--text-mid)" }}>Management style (descriptive)</div>
      <div className="rounded-lg p-4" style={{ background: "var(--surface-1, rgba(255,255,255,0.03))", border: "1px solid var(--border, rgba(255,255,255,0.07))" }}>
        <StyleAxis left="Directive" right="Participative" value={r.style.directive_participative} />
        <StyleAxis left="Task focus" right="Relationship focus" value={r.style.task_relationship} />
        <div className="text-[13px] mt-2"><span className="font-display">{r.style.primary_style}</span><span style={{ color: "var(--text-mid)" }}> under normal conditions.</span></div>
        {r.style.pressure_shift_note && <div className="text-[13px] mt-1.5" style={{ color: "var(--text-mid)" }}>Under pressure → <span style={{ color: "var(--text-hi, #c9c4b8)" }}>{r.style.under_pressure_style}</span>: {r.style.pressure_shift_note}</div>}
        {r.style.fit_read && <div className="text-[12.5px] mt-3 pt-3" style={{ borderTop: "1px solid var(--border, rgba(255,255,255,0.07))", color: "var(--text-mid)" }}><span style={{ color: "var(--text-hi, #c9c4b8)" }}>Fit to this role & team ({r.style.fit_score}): </span>{r.style.fit_read}</div>}
      </div>

      {/* pressure + timing */}
      <div className="mt-7 mb-2 font-display text-[13px] uppercase tracking-wide" style={{ color: "var(--text-mid)" }}>Composure under pressure</div>
      <div className="rounded-lg p-4 text-[13px]" style={{ background: "var(--surface-1, rgba(255,255,255,0.03))", border: "1px solid var(--border, rgba(255,255,255,0.07))" }}>
        <div>{r.pressure.composure_read}</div>
        {r.pressure.breather_use && <div className="mt-1.5" style={{ color: "var(--text-mid)" }}>Breather use: {r.pressure.breather_use}</div>}
        <div className="mt-2 pt-2 text-[12.5px]" style={{ borderTop: "1px solid var(--border, rgba(255,255,255,0.07))", color: "var(--text-mid)" }}>{r.timing_summary}</div>
        {r.pressure.rushed_under_tension && <div className="mt-1.5 text-[12px]" style={{ color: "#c8a35a" }}>⚠ Pace collapsed when pressure spiked — fired back rather than taking a beat.</div>}
      </div>

      {r.objectives.length > 0 && (
        <>
          <div className="mt-7 mb-2 font-display text-[13px] uppercase tracking-wide" style={{ color: "var(--text-mid)" }}>Objectives</div>
          <div className="grid grid-cols-1 gap-2">
            {r.objectives.map((o) => (
              <div key={o.id} className="rounded-lg p-3 flex items-start gap-3" style={{ background: "var(--surface-1, rgba(255,255,255,0.03))", border: "1px solid var(--border, rgba(255,255,255,0.07))" }}>
                <div className="font-mono text-[13px] mt-0.5 shrink-0" style={{ color: scoreColor(o.score) }}>{o.met ? "✓" : "○"} {o.score}</div>
                <div><div className="text-[13px]">{o.label}</div>{o.evidence && <div className="text-[12px] mt-0.5" style={{ color: "var(--text-mid)" }}>{o.evidence}</div>}</div>
              </div>
            ))}
          </div>
        </>
      )}

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

      {r.missed_signals.length > 0 && (
        <div className="mt-7">
          <div className="mb-2 font-display text-[13px] uppercase tracking-wide" style={{ color: "var(--text-mid)" }}>Signals not surfaced</div>
          <ul className="space-y-1">{r.missed_signals.map((m, i) => <li key={i} className="text-[13px] pl-3" style={{ color: "var(--text-mid)", borderLeft: "2px solid #c8a35a" }}>{m}</li>)}</ul>
        </div>
      )}

      {(r.strongest_moments.length > 0 || r.costliest_moments.length > 0) && (
        <div className="mt-7 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="mb-2 font-display text-[12px] uppercase tracking-wide" style={{ color: "var(--accent, #6aa67a)" }}>Strongest moments</div>
            {r.strongest_moments.map((m, i) => <div key={i} className="text-[12.5px] mb-1.5" style={{ color: "var(--text-mid)" }}><span className="font-mono">T{m.turn}</span> — {m.note}</div>)}
          </div>
          <div>
            <div className="mb-2 font-display text-[12px] uppercase tracking-wide" style={{ color: "#c07a6a" }}>Costliest moments</div>
            {r.costliest_moments.map((m, i) => <div key={i} className="text-[12.5px] mb-1.5" style={{ color: "var(--text-mid)" }}><span className="font-mono">T{m.turn}</span> — {m.note}</div>)}
          </div>
        </div>
      )}

      {r.reviewer_note && (
        <div className="mt-7 rounded-lg p-4" style={{ background: "var(--surface-2, rgba(255,255,255,0.05))", border: "1px solid var(--border, rgba(255,255,255,0.07))" }}>
          <div className="text-[11px] uppercase tracking-wide mb-2" style={{ color: "var(--text-mid)" }}>For the reviewer</div>
          <div className="text-[13.5px] leading-relaxed">{r.reviewer_note}</div>
        </div>
      )}

      {/* the password-gated scopes */}
      <ScopesPanel save={save} />

      {/* decision-support guardrail — always shown */}
      <div className="mt-7 rounded-lg p-3.5 text-[12px] leading-relaxed" style={{ background: "rgba(192,122,106,0.08)", border: "1px solid rgba(192,122,106,0.3)", color: "var(--text-mid)" }}>
        {r.decision_support_notice}
      </div>

      {onClose && (
        <button onClick={onClose} className="mt-6 mb-12 px-4 py-2 rounded-lg text-[13px]" style={{ background: "var(--surface-1, rgba(255,255,255,0.04))", border: "1px solid var(--border, rgba(255,255,255,0.08))" }}>Back</button>
      )}
    </div>
  );
}
