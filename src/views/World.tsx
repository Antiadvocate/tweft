import React from "react";
import { motion } from "motion/react";
import type { ClientSave } from "../lib/api";
import { RelationshipWeb } from "./RelationshipWeb";
import { nice } from "../lib/format";

export default function World({ save }: { save: ClientSave }) {
  const w = save.world;
  const liveRumors = w.rumors.filter((r) => !r.dead);
  const activeThreads = w.threads.filter((t) => t.status === "active");
  const name = (id: string) => save.characters[id]?.name ?? id;

  const ut = (save as any).undertow as
    | { regime?: string; lyapunov?: number; coherence?: number; early_warning?: boolean; stances?: { name: string; stance: string; p: number; vs: string }[] }
    | undefined;
  const regimeColor = ut?.regime === "cascading" ? "var(--danger)" : ut?.regime === "critical" ? "var(--accent)" : "var(--calm)";

  return (
    <div className="scroll-y h-full px-4 pb-10 pt-3 space-y-3">
      {ut?.regime && (
        <Block title="The Undertow" delay={0}>
          <div className="flex items-center gap-3 py-1">
            <span className="w-2 h-2 rounded-full" style={{ background: regimeColor, boxShadow: `0 0 8px ${regimeColor}` }} />
            <span className="font-display text-[15px]" style={{ color: regimeColor }}>
              {ut.regime === "cascading" ? "Cascading — small acts ripple far" : ut.regime === "critical" ? "Critical — the world is taut" : "Damped — the world absorbs shocks"}
            </span>
          </div>
          <div className="font-mono text-[10px] mt-1" style={{ color: "var(--text-lo)" }}>
            λ̂ = {ut.lyapunov?.toFixed(3)} (sensitivity) · R = {ut.coherence?.toFixed(2)} (social coherence)
          </div>
          {ut.early_warning && (
            <div className="font-mono text-[10.5px] mt-2 px-2.5 py-1.5 rounded-lg" style={{ color: "var(--accent)", background: "var(--accent-soft)", border: "1px solid var(--accent-glow)" }}>
              ⚠ critical slowing detected — your inner weather is gathering toward a shift
            </div>
          )}
          {(ut.stances?.length ?? 0) > 0 && (
            <div className="mt-2.5 space-y-1">
              {ut.stances!.map((st, i) => (
                <div key={i} className="flex justify-between text-[12.5px]">
                  <span>{st.name} <span style={{ color: "var(--text-lo)" }}>vs {st.vs}</span></span>
                  <span className="font-mono text-[10px]" style={{ color: st.stance === "press" ? "var(--danger)" : st.stance === "yield" ? "var(--calm)" : "var(--text-mid)" }}>
                    {st.stance} · {(st.p * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
              <div className="text-[10.5px] italic pt-1" style={{ color: "var(--text-lo)" }}>
                Postures are quantal equilibria of each rivalry's stance game — clenched minds play noisier, fear-distorted strategies.
              </div>
            </div>
          )}
        </Block>
      )}
      <Block title="The web" delay={0.03}>
        <RelationshipWeb save={save} />
      </Block>

      <Block title="Threads" delay={0.04}>
        {activeThreads.length === 0 && <Empty>Nothing pulling at the weave yet.</Empty>}
        {activeThreads.map((t) => (
          <div key={t.id} className="py-2">
            <div className="flex justify-between items-baseline gap-2">
              <div className="font-display text-[14px]">{t.title}</div>
              <span className="font-mono text-[9.5px] shrink-0" style={{ color: t.tension >= 7 ? "var(--danger)" : "var(--text-lo)" }}>
                tension {t.tension}/10
              </span>
            </div>
            <div className="text-[12.5px] mt-0.5 leading-relaxed" style={{ color: "var(--text-mid)" }}>{t.description}</div>
            <div className="meter mt-2"><div style={{ width: `${t.tension * 10}%`, background: t.tension >= 7 ? "var(--danger)" : "var(--accent)" }} /></div>
          </div>
        ))}
      </Block>

      <Block title="Clocks" delay={0.05}>
        {w.clocks.length === 0 && <Empty>No factions on the move.</Empty>}
        {w.clocks.map((c) => (
          <div key={c.id} className="py-2">
            <div className="flex justify-between items-baseline gap-2">
              <div className="font-display text-[14px]">{c.faction}</div>
              <span className="chip" style={c.status === "fired" ? { color: "var(--danger)", borderColor: "rgba(199,81,70,.4)" } : undefined}>
                {c.status === "fired" ? "fired" : `${c.filled}/${c.segments}`}
              </span>
            </div>
            <div className="text-[12.5px] mt-0.5" style={{ color: "var(--text-mid)" }}>{c.objective}</div>
            <div className="flex gap-1 mt-2">
              {Array.from({ length: c.segments }).map((_, i) => (
                <div key={i} className="h-2 flex-1 rounded-sm"
                  style={{ background: i < c.filled ? "var(--accent)" : "var(--ink-3)" }} />
              ))}
            </div>
          </div>
        ))}
      </Block>

      <Block title="What people are saying" delay={0.1}>
        {liveRumors.length === 0 && <Empty>The air is quiet. For now.</Empty>}
        {liveRumors.map((r) => (
          <div key={r.id} className="py-2">
            <div className="text-[13px] leading-relaxed italic">"{r.content}"</div>
            <div className="font-mono text-[9.5px] mt-1 flex gap-2" style={{ color: "var(--text-lo)" }}>
              <span style={r.truth !== "true" ? { color: "var(--danger)" } : undefined}>{r.truth}</span>
              <span>· {r.knowers.length} know · from {name(r.origin_char)}</span>
            </div>
          </div>
        ))}
      </Block>

      <Block title="Norms" delay={0.15}>
        {w.norms.map((n) => (
          <div key={n.id} className="py-1.5 text-[13px]">
            <span style={{ color: "var(--text-hi)" }}>{n.rule}</span>
            <span className="font-mono text-[9.5px] ml-2" style={{ color: "var(--text-lo)" }}>({n.enforcement} — {n.holders})</span>
          </div>
        ))}
      </Block>

      <Block title="Places" delay={0.2}>
        {Object.values(w.places).map((p) => (
          <div key={p.id} className="py-1.5">
            <span className="font-display text-[13.5px]">
              {p.name}{w.player_location === p.id && <span style={{ color: "var(--accent)" }}> ◂ you</span>}
            </span>
            <div className="text-[12px]" style={{ color: "var(--text-lo)" }}>{p.description_facts}</div>
          </div>
        ))}
      </Block>
    </div>
  );
}

function Block({ title, delay, children }: { title: string; delay: number; children: React.ReactNode }) {
  return (
    <motion.div className="card p-4"
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}>
      <div className="font-mono text-[10px] uppercase tracking-widest mb-1.5" style={{ color: "var(--text-lo)" }}>{title}</div>
      {children}
    </motion.div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-[12.5px] italic py-1" style={{ color: "var(--text-lo)" }}>{children}</div>;
}
