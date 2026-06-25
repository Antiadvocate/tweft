import React, { useState } from "react";
import { motion } from "motion/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { InterviewReport, CompetencyRead, InterviewConfig, DecisiveMoment } from "../engine/interview-types";
import { SPECTRUM_POLES } from "../engine/interview-types";
import type { ClientSave } from "../lib/api";
import { api } from "../lib/api";

const ACCENT = "var(--accent, #6aa67a)";

/** A labeled spectrum with a marker at `position` (0–100). Both poles legitimate. */
function Spectrum({ low, high, position, compact = false }: { low: string; high: string; position: number; compact?: boolean }) {
  return (
    <div className={compact ? "" : "mb-1"}>
      <div className="flex justify-between text-[11px] mb-1" style={{ color: "var(--text-mid)" }}>
        <span>{low}</span><span>{high}</span>
      </div>
      <div className="relative h-2 rounded-full" style={{ background: "linear-gradient(90deg, rgba(127,174,138,0.25), rgba(200,163,90,0.25), rgba(127,174,138,0.25))" }}>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-px h-2" style={{ background: "var(--border)" }} />
        </div>
        <motion.div initial={{ left: "50%" }} animate={{ left: `${position}%` }} transition={{ duration: 0.6, ease: "easeOut" }}
          className="absolute top-1/2 w-3.5 h-3.5 rounded-full -translate-x-1/2 -translate-y-1/2"
          style={{ background: "var(--text-hi, #c9c4b8)", boxShadow: `0 0 0 3px var(--bg, #111), 0 0 0 4px ${ACCENT}` }} />
      </div>
    </div>
  );
}

/** competency spectrum row in the at-a-glance profile */
function CompetencyProfile({ spine }: { spine: CompetencyRead[] }) {
  return (
    <div className="grid grid-cols-1 gap-3">
      {spine.map((c) => {
        const poles = SPECTRUM_POLES[c.competency];
        return (
          <div key={c.competency}>
            <div className="text-[12px] mb-1" style={{ color: "var(--text-hi, #c9c4b8)" }}>{c.label}</div>
            <Spectrum low={poles.low} high={poles.high} position={c.position} compact />
          </div>
        );
      })}
    </div>
  );
}

function DecisiveMoments({ moments }: { moments: DecisiveMoment[] }) {
  if (!moments.length) return null;
  return (
    <div className="grid grid-cols-1 gap-2">
      {moments.map((m, i) => {
        const strength = m.kind === "strength";
        const color = strength ? ACCENT : "#c8a35a";
        return (
          <div key={i} className="rounded-lg p-3" style={{ background: "var(--surface-1, rgba(255,255,255,0.03))", borderLeft: `3px solid ${color}` }}>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-[11px] px-1.5 py-0.5 rounded" style={{ background: `${color}22`, color }}>T{m.turn}</span>
              <span className="text-[11px] uppercase tracking-wide" style={{ color }}>{strength ? "strength shown" : "growth edge"}</span>
            </div>
            <div className="text-[13.5px] leading-snug">{m.action}</div>
            <div className="text-[12.5px] mt-1" style={{ color: "var(--text-mid)" }}>→ {m.consequence}</div>
          </div>
        );
      })}
    </div>
  );
}

const CompCard: React.FC<{ c: CompetencyRead }> = ({ c }) => {
  const poles = SPECTRUM_POLES[c.competency];
  return (
    <div className="rounded-lg p-3.5" style={{ background: "var(--surface-1, rgba(255,255,255,0.03))", border: "1px solid var(--border, rgba(255,255,255,0.07))" }}>
      <div className="font-display text-[14px] mb-2">{c.label}</div>
      <Spectrum low={poles.low} high={poles.high} position={c.position} />
      {c.read && <div className="text-[13px] mt-2">{c.read}</div>}
      {c.evidence && <div className="text-[12px] mt-1.5" style={{ color: "var(--text-mid)" }}>{c.evidence}</div>}
      {c.in_this_situation && <div className="text-[12px] mt-1.5"><span style={{ color: ACCENT }}>Fit here — </span><span style={{ color: "var(--text-mid)" }}>{c.in_this_situation}</span></div>}
      {c.to_develop && <div className="text-[12px] mt-1.5"><span style={{ color: "#c8a35a" }}>To develop — </span><span style={{ color: "var(--text-mid)" }}>{c.to_develop}</span></div>}
    </div>
  );
};

function StyleAxis({ left, right, value }: { left: string; right: string; value: number }) {
  return <Spectrum low={left} high={right} position={value} />;
}

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
            <div className="text-[13px] mb-4 pb-3" style={{ borderBottom: "1px solid var(--border)", color: "var(--text-mid)" }}>{save.interview.opening_message}</div>
          )}
          {turns.map((h: any, i: number) => (
            <div key={i} className="mb-4">
              {h.player_action && (
                <div className="mb-2">
                  <span className="text-[11px] uppercase tracking-wide font-mono" style={{ color: ACCENT }}>Manager (T{h.turn})</span>
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
      <div className="text-[11px] uppercase tracking-wide mb-2" style={{ color: "var(--text-mid)" }}>Coach scopes (password-gated)</div>
      {!open ? (
        <div className="flex items-center gap-2">
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && unlock()} placeholder="Coach password" className="flex-1 rounded-lg p-2 text-[13px]" style={{ background: "var(--surface-2, rgba(255,255,255,0.05))", border: "1px solid var(--border, rgba(255,255,255,0.08))" }} />
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
                : gap > 20 ? `misreads them (${Math.round(gap)} pts off)` : "freshly thrown by something they did")
              : belief ? "reads them accurately" : null;
            return (
              <div key={id} className="rounded-md p-2.5 text-[12.5px]" style={{ background: "var(--surface-2, rgba(255,255,255,0.05))" }}>
                <span className="font-display">{c.name}</span>
                <span style={{ color: "var(--text-mid)" }}> — mood {cond?.psyche?.mood ?? "—"} (relaxation {cond?.psyche?.relaxation ?? 0}); warmth {edge?.warmth ?? 0}, trust {edge?.trust ?? 0}{drive?.goal ? `; still wants: ${drive.goal}` : ""}</span>
                {readNote && <div className="mt-1 text-[11.5px]" style={{ color: readNote.startsWith("reads them accurately") ? "var(--text-low, var(--text-mid))" : "#c8a35a" }}>↳ their read of the manager: {readNote}</div>}
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
    <div className="h-full overflow-y-auto px-5 sm:px-8 py-6 max-w-3xl mx-auto print-area">

      <div className="text-[11px] uppercase tracking-wide mb-3" style={{ color: "var(--text-mid)" }}>
        Development review · {r.role_title} · {r.level.replace(/_/g, " ")}
      </div>

      {/* ═══ characterization header ═══ */}
      <div className="rounded-2xl p-5 mb-5" style={{ background: `linear-gradient(135deg, rgba(106,166,122,0.10), var(--surface-1, rgba(255,255,255,0.03)))`, border: "1px solid var(--border, rgba(255,255,255,0.1))" }}>
        <div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: ACCENT }}>Manager type</div>
        <div className="font-display text-[22px] leading-tight mb-2" style={{ fontVariationSettings: '"SOFT" 60' }}>{r.manager_type}</div>
        <div className="text-[13.5px]" style={{ color: "var(--text-mid)" }}>{r.summary}</div>

        {r.objectives.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {r.objectives.map((o) => (
              <div key={o.id} className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px]"
                style={{ background: o.met ? "rgba(106,166,122,0.18)" : "rgba(192,122,106,0.14)", border: `1px solid ${o.met ? "rgba(106,166,122,0.5)" : "rgba(192,122,106,0.4)"}` }}>
                <span style={{ color: o.met ? ACCENT : "#c07a6a" }}>{o.met ? "✓" : "○"}</span>
                <span>{o.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ═══ style profile (the at-a-glance spectrums) ═══ */}
      <div className="rounded-2xl p-5 mb-6" style={{ background: "var(--surface-1, rgba(255,255,255,0.03))", border: "1px solid var(--border, rgba(255,255,255,0.08))" }}>
        <div className="text-[11px] uppercase tracking-wide mb-3" style={{ color: "var(--text-mid)" }}>Where this manager sits</div>
        <div className="mb-4 pb-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <StyleAxis left="Directive" right="Participative" value={r.style.directive_participative} />
            <StyleAxis left="Task focus" right="Relationship focus" value={r.style.task_relationship} />
          </div>
          {r.style.primary_style && <div className="text-[13px] mt-3"><span className="font-display">{r.style.primary_style}</span><span style={{ color: "var(--text-mid)" }}> under normal conditions.</span></div>}
          {r.style.pressure_shift_note && <div className="text-[13px] mt-1" style={{ color: "var(--text-mid)" }}>Under pressure → <span style={{ color: "var(--text-hi, #c9c4b8)" }}>{r.style.under_pressure_style}</span>: {r.style.pressure_shift_note}</div>}
        </div>
        <CompetencyProfile spine={r.spine} />
      </div>

      {/* ═══ what they actually did ═══ */}
      {r.decisive_moments.length > 0 && (
        <>
          <div className="mb-2 font-display text-[13px] uppercase tracking-wide" style={{ color: "var(--text-mid)" }}>What they actually did</div>
          <div className="mb-6"><DecisiveMoments moments={r.decisive_moments} /></div>
        </>
      )}

      {/* ═══ development focus + strengths ═══ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        {r.development_focus.length > 0 && (
          <div className="rounded-lg p-4" style={{ background: "rgba(200,163,90,0.08)", border: "1px solid rgba(200,163,90,0.3)" }}>
            <div className="mb-2 font-display text-[12px] uppercase tracking-wide" style={{ color: "#c8a35a" }}>Practice next</div>
            <ul className="space-y-1.5">{r.development_focus.map((d, i) => <li key={i} className="text-[13px] flex gap-2"><span style={{ color: "#c8a35a" }}>→</span><span>{d}</span></li>)}</ul>
          </div>
        )}
        {r.strengths_to_keep.length > 0 && (
          <div className="rounded-lg p-4" style={{ background: "rgba(106,166,122,0.08)", border: "1px solid rgba(106,166,122,0.3)" }}>
            <div className="mb-2 font-display text-[12px] uppercase tracking-wide" style={{ color: ACCENT }}>Strengths to keep</div>
            <ul className="space-y-1.5">{r.strengths_to_keep.map((s, i) => <li key={i} className="text-[13px] flex gap-2"><span style={{ color: ACCENT }}>•</span><span>{s}</span></li>)}</ul>
          </div>
        )}
      </div>

      {/* ═══ competency detail ═══ */}
      <div className="mb-2 font-display text-[13px] uppercase tracking-wide" style={{ color: "var(--text-mid)" }}>Style detail</div>
      <div className="grid grid-cols-1 gap-2.5 mb-6">{r.spine.map((c) => <CompCard key={c.competency} c={c} />)}</div>

      {/* ═══ cross-functional (subtle, secondary) ═══ */}
      {(r.cross_functional.read || r.cross_functional.mission_vs_silo) && (
        <div className="mb-6 rounded-lg p-4" style={{ background: "var(--surface-1, rgba(255,255,255,0.03))", border: "1px solid var(--border, rgba(255,255,255,0.07))" }}>
          <div className="mb-2.5 font-display text-[12px] uppercase tracking-wide" style={{ color: "var(--text-mid)" }}>Cross-functional orientation</div>
          <Spectrum low="Protects own turf" high="Spans boundaries" position={r.cross_functional.position} />
          {r.cross_functional.read && <div className="text-[13px] mt-2.5">{r.cross_functional.read}</div>}
          {r.cross_functional.mission_vs_silo && <div className="text-[12px] mt-1.5" style={{ color: "var(--text-mid)" }}>{r.cross_functional.mission_vs_silo}</div>}
          {r.cross_functional.evidence && <div className="text-[12px] mt-1.5" style={{ color: "var(--text-low, var(--text-mid))" }}>↳ {r.cross_functional.evidence}</div>}
        </div>
      )}

      {/* composure + timing */}
      <div className="mb-2 font-display text-[13px] uppercase tracking-wide" style={{ color: "var(--text-mid)" }}>Composure under pressure</div>
      <div className="rounded-lg p-4 text-[13px] mb-6" style={{ background: "var(--surface-1, rgba(255,255,255,0.03))", border: "1px solid var(--border, rgba(255,255,255,0.07))" }}>
        <div>{r.pressure.composure_read}</div>
        {r.pressure.breather_use && <div className="mt-1.5" style={{ color: "var(--text-mid)" }}>Breather use: {r.pressure.breather_use}</div>}
        <div className="mt-2 pt-2 text-[12.5px]" style={{ borderTop: "1px solid var(--border, rgba(255,255,255,0.07))", color: "var(--text-mid)" }}>{r.timing_summary}</div>
        {r.pressure.rushed_under_tension && <div className="mt-1.5 text-[12px]" style={{ color: "#c8a35a" }}>Note: pace quickened when pressure spiked — fired back rather than taking a beat.</div>}
      </div>

      {/* relationship deltas */}
      {r.relationship_deltas.length > 0 && (
        <>
          <div className="mb-2 font-display text-[13px] uppercase tracking-wide" style={{ color: "var(--text-mid)" }}>How each relationship moved</div>
          <div className="grid grid-cols-1 gap-1.5 mb-6">
            {r.relationship_deltas.map((d) => (
              <div key={d.report_id} className="rounded-lg px-3 py-2 text-[13px] flex items-center gap-3" style={{ background: "var(--surface-1, rgba(255,255,255,0.03))" }}>
                <span className="font-display shrink-0 w-24 truncate">{d.name}</span>
                <span className="font-mono text-[12px] shrink-0" style={{ color: d.warmth_delta >= 0 ? ACCENT : "#c07a6a" }}>w{d.warmth_delta >= 0 ? "+" : ""}{d.warmth_delta}</span>
                <span className="font-mono text-[12px] shrink-0" style={{ color: d.trust_delta >= 0 ? ACCENT : "#c07a6a" }}>t{d.trust_delta >= 0 ? "+" : ""}{d.trust_delta}</span>
                <span style={{ color: "var(--text-mid)" }} className="truncate">{d.read}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* missed signals */}
      {r.missed_signals.length > 0 && (
        <div className="mb-6">
          <div className="mb-2 font-display text-[13px] uppercase tracking-wide" style={{ color: "var(--text-mid)" }}>Signals not surfaced</div>
          <ul className="space-y-1">{r.missed_signals.map((m, i) => <li key={i} className="text-[13px] pl-3" style={{ color: "var(--text-mid)", borderLeft: "2px solid #c8a35a" }}>{m}</li>)}</ul>
        </div>
      )}

      {/* coach paragraph */}
      {r.reviewer_note && (
        <div className="rounded-lg p-4 mb-2" style={{ background: "var(--surface-2, rgba(255,255,255,0.05))", border: "1px solid var(--border, rgba(255,255,255,0.07))" }}>
          <div className="text-[11px] uppercase tracking-wide mb-2" style={{ color: "var(--text-mid)" }}>Coaching summary</div>
          <div className="text-[13.5px] leading-relaxed">{r.reviewer_note}</div>
        </div>
      )}

      <Transcript save={save} />
      <ScopesPanel save={save} />

      <div className="mt-7 rounded-lg p-3.5 text-[12px] leading-relaxed" style={{ background: "rgba(127,127,127,0.08)", border: "1px solid var(--border)", color: "var(--text-mid)" }}>
        {r.decision_support_notice}
      </div>

      <div className="flex items-center gap-3 mt-6 mb-12 no-print">
        <button onClick={() => window.print()} className="px-4 py-2 rounded-lg text-[13px] font-display" style={{ background: ACCENT, color: "var(--bg, #111)" }}>Save as PDF</button>
        {onClose && <button onClick={onClose} className="px-4 py-2 rounded-lg text-[13px]" style={{ background: "var(--surface-1, rgba(255,255,255,0.04))", border: "1px solid var(--border, rgba(255,255,255,0.08))" }}>Back</button>}
      </div>
    </div>
  );
}
