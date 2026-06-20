import React, { useMemo } from "react";
import { motion } from "motion/react";
import type { ClientSave } from "../lib/api";
import { Bars, MoodArc, Sparkline, Stat, Seismograph } from "../lib/charts";
import { nice, niceCap } from "../lib/format";

/** Everything here is computed locally from telemetry — zero token cost. */
export default function Chronicle({ save }: { save: ClientSave }) {
  const tel = save.telemetry;
  const name = (id: string) => save.characters[id]?.name ?? id;

  const stats = useMemo(() => {
    const turns = tel.length;
    const words = tel.reduce((a, t) => a + t.word_count, 0);
    const tokens = tel.reduce((a, t) => a + t.narrator_tokens_in + t.narrator_tokens_out + t.simulator_tokens_in + t.simulator_tokens_out + t.reflection_tokens, 0);
    const ms = tel.reduce((a, t) => a + t.duration_ms, 0);
    const avgPressure = turns ? tel.reduce((a, t) => a + t.pressure, 0) / turns : 0;
    const peak = tel.reduce((m, t) => (t.pressure > m.pressure ? t : m), tel[0] ?? { pressure: 0, turn: 0 } as any);

    // cast screen time
    const screen: Record<string, number> = {};
    for (const t of tel) for (const id of t.present) if (id !== "char_player") screen[id] = (screen[id] ?? 0) + 1;
    const screenTime = Object.entries(screen)
      .sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([id, v]) => ({ label: name(id), value: v }));

    // relationship trajectories: per other-char warmth series from edge snapshots
    const series: Record<string, number[]> = {};
    for (const t of tel) for (const e of t.edge_snapshot) {
      const other = e.pair;
      (series[other] ??= []).push(e.warmth);
    }
    const bonds = Object.entries(series)
      .filter(([, v]) => v.length >= 2)
      .sort((a, b) => Math.abs(b[1][b[1].length - 1] - b[1][0]) - Math.abs(a[1][a[1].length - 1] - a[1][0]))
      .slice(0, 5);

    // pace: minutes of fiction per turn
    const moods = tel.map((t) => t.player_mood_valence);
    const pressures = tel.map((t) => t.pressure);

    // fun facts
    const rumorsBorn = save.world.rumors.length;
    const rumorsFalse = save.world.rumors.filter((r) => r.truth !== "true").length;
    const beliefs = Object.values(save.memory).reduce((a, m) => a + m.beliefs.length, 0);
    const memTotal = Object.values(save.memory).reduce((a, m) => a + m.episodic.length, 0);
    const traitsGrown = Object.values(save.traits).reduce((a, t) => a + t.length, 0);
    const consequencesFired = save.world.consequences.filter((c) => c.status === "fired").length;
    const quietest = tel.length ? tel.reduce((m, t) => (t.pressure < m.pressure ? t : m), tel[0]) : null;

    return { turns, words, tokens, ms, avgPressure, peak, screenTime, bonds, moods, pressures, rumorsBorn, rumorsFalse, beliefs, memTotal, traitsGrown, consequencesFired, quietest };
  }, [tel, save]);

  if (!tel.length) {
    return (
      <div className="h-full flex items-center justify-center px-8 text-center">
        <div>
          <div className="font-display text-lg mb-1.5">Nothing chronicled yet.</div>
          <div className="text-[13px]" style={{ color: "var(--text-mid)" }}>Play a few turns. The loom keeps its own ledger — every chart here costs zero tokens.</div>
        </div>
      </div>
    );
  }

  const facts: string[] = [
    `${stats.rumorsBorn} rumors entered the world — ${stats.rumorsFalse} of them weren't true.`,
    `The cast holds ${stats.memTotal} memories and has distilled ${stats.beliefs} beliefs about you and each other.`,
    stats.traitsGrown > 0 ? `${stats.traitsGrown} acquired traits have grown on people because of what happened.` : `No one has been permanently changed yet. Give it time.`,
    stats.consequencesFired > 0 ? `${stats.consequencesFired} delayed consequences came back around.` : `Consequences are still in flight. They land whether you watch or not.`,
    stats.peak?.turn ? `Pressure peaked at ${stats.peak.pressure}/10 on turn ${stats.peak.turn}.` : ``,
  ].filter(Boolean);

  // ── character arcs: who changed, and how ──
  const arcs = useMemo(() => {
    const screen: Record<string, number> = {};
    for (const t of tel) for (const id of t.present) if (id !== "char_player") screen[id] = (screen[id] ?? 0) + 1;
    const top = Object.entries(screen).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => id);
    return top.map((id) => {
      const c = save.characters[id];
      const warmth: number[] = [];
      const trust: number[] = [];
      for (const t of tel) {
        const e = t.edge_snapshot.find((x) => x.pair === c.name);
        if (e) { warmth.push(e.warmth); trust.push(e.trust); }
      }
      const traits = (save.traits[id] ?? []).slice().sort((a, b) => b.self_weight - a.self_weight);
      const beliefs = (save.memory[id]?.beliefs ?? []).slice(-2);
      const psy = save.condition[id]?.psyche;
      const memories = save.memory[id]?.episodic ?? [];
      const heaviest = memories.slice().sort((a, b) => b.importance - a.importance)[0];
      return { id, c, warmth, trust, traits, beliefs, psy, heaviest, scenes: screen[id] };
    });
  }, [tel, save]);

  // ── superlatives: the records of this chronicle ──
  const records = useMemo(() => {
    const out: { label: string; value: string }[] = [];
    if (!tel.length) return out;
    // most volatile bond: greatest warmth range
    let volName = "", volRange = 0;
    const byPair: Record<string, number[]> = {};
    for (const t of tel) for (const e of t.edge_snapshot) (byPair[e.pair] ??= []).push(e.warmth);
    for (const [nm, vals] of Object.entries(byPair)) {
      const r = Math.max(...vals) - Math.min(...vals);
      if (r > volRange) { volRange = r; volName = nm; }
    }
    if (volName && volRange >= 8) out.push({ label: "Most volatile bond", value: `${volName} — warmth swung ${Math.round(volRange)} points` });
    // steadiest companion
    const screen: Record<string, number> = {};
    for (const t of tel) for (const id of t.present) if (id !== "char_player") screen[id] = (screen[id] ?? 0) + 1;
    const steadiest = Object.entries(screen).sort((a, b) => b[1] - a[1])[0];
    if (steadiest) out.push({ label: "Steadiest companion", value: `${save.characters[steadiest[0]]?.name} — in ${steadiest[1]} of ${tel.length} scenes` });
    // busiest gossip
    const gossip: Record<string, number> = {};
    for (const r of save.world.rumors) gossip[r.origin_char] = (gossip[r.origin_char] ?? 0) + 1;
    const talker = Object.entries(gossip).sort((a, b) => b[1] - a[1])[0];
    if (talker && talker[1] >= 2) out.push({ label: "Busiest tongue", value: `${save.characters[talker[0]]?.name ?? "someone"} started ${talker[1]} rumors` });
    // longest quiet
    let q = 0, best = 0;
    for (const t of tel) { q = t.pressure <= 2 ? q + 1 : 0; best = Math.max(best, q); }
    if (best >= 3) out.push({ label: "The long quiet", value: `${best} consecutive turns at low pressure` });
    // the day everything happened
    const busiest = save.history.slice().sort((a, b) => (b.shifts?.length ?? 0) - (a.shifts?.length ?? 0))[0];
    if (busiest?.shifts?.length) out.push({ label: "The day everything happened", value: `turn ${busiest.turn} — ${busiest.shifts.length} shifts (${busiest.time_label})` });
    // deepest mark: most reinforced trait in the world
    let mark: { name: string; label: string; n: number } | null = null;
    for (const [id, ts] of Object.entries(save.traits)) for (const t of ts ?? []) {
      if (!mark || t.reinforcement_count > mark.n) mark = { name: save.characters[id]?.name ?? id, label: t.label, n: t.reinforcement_count };
    }
    if (mark && mark.n >= 2) out.push({ label: "Deepest mark", value: `${mark.name} — "${niceCap(mark.label)}", reinforced ×${mark.n}` });
    for (const v of save.vessel_history ?? []) {
      out.push({ label: "A vessel changed", value: `${v.from_name} → ${v.to_name}, turn ${v.turn} (${v.time_label})` });
    }
    const interludes = save.history.filter((h) => h.kind === "interlude").length;
    if (interludes) out.push({ label: "The world turned alone", value: `${interludes} interlude${interludes > 1 ? "s" : ""} — days the chronicle ran without you` });
    const tipped = tel.find((t) => t.regime === "cascading");
    if (tipped) out.push({ label: "The day the world tipped", value: `turn ${tipped.turn} — λ̂ went positive (${tipped.lyapunov?.toFixed(2)}); everything after rippled` });
    const warned = tel.filter((t) => t.early_warning).length;
    if (warned) out.push({ label: "Storm warnings", value: `${warned} turn${warned > 1 ? "s" : ""} of critical slowing before shifts — the math saw it coming` });
    return out;
  }, [tel, save]);

  const marginalia = save.history
    .flatMap((h) => (h.shifts ?? []).map((sh) => ({ turn: h.turn, time: h.time_label, text: sh })))
    .slice(-30)
    .reverse();

  return (
    <div className="scroll-y h-full px-4 pb-10 pt-3 space-y-3">
      {marginalia.length > 0 && (
        <Fade delay={0}>
          <div className="card p-4">
            <Title>Marginalia — what the world noted</Title>
            <div className="space-y-1.5 mt-1 max-h-64 overflow-y-auto scroll-y">
              {marginalia.map((m, i) => (
                <div key={i} className="flex gap-2.5 items-baseline">
                  <span className="font-mono text-[9px] shrink-0 w-7" style={{ color: "var(--text-lo)" }}>t{m.turn}</span>
                  <span className="text-[12.5px] leading-relaxed" style={{ color: "var(--text-mid)" }}>{m.text}</span>
                </div>
              ))}
            </div>
          </div>
        </Fade>
      )}
      <Fade delay={0}>
        <div className="card p-4">
          <div className="font-mono text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--text-lo)" }}>Token usage — this chronicle</div>
          {(() => {
            const inTok = tel.reduce((a, t) => a + t.narrator_tokens_in + t.simulator_tokens_in, 0);
            const outTok = tel.reduce((a, t) => a + t.narrator_tokens_out + t.simulator_tokens_out, 0);
            const narrTok = tel.reduce((a, t) => a + t.narrator_tokens_in + t.narrator_tokens_out, 0);
            const perTurn = Math.round(stats.tokens / Math.max(stats.turns, 1));
            const nm = save.model_settings.narrator_model;
            const pricey = /opus|gpt-5(\.5)?\b|gpt-image|sonnet-4\.[5-9]|\bpro\b/i.test(nm);
            return (
              <>
                <div className="flex justify-between text-[13px] py-0.5"><span style={{ color: "var(--text-mid)" }}>Input tokens</span><span className="font-mono">{inTok.toLocaleString()}</span></div>
                <div className="flex justify-between text-[13px] py-0.5"><span style={{ color: "var(--text-mid)" }}>Output tokens</span><span className="font-mono">{outTok.toLocaleString()}</span></div>
                <div className="flex justify-between text-[13px] py-0.5" style={{ borderTop: "1px solid var(--line)", marginTop: 4, paddingTop: 6 }}><span>Total</span><span className="font-mono">{stats.tokens.toLocaleString()}</span></div>
                <div className="flex justify-between text-[12px] py-0.5"><span style={{ color: "var(--text-lo)" }}>per turn (avg)</span><span className="font-mono" style={{ color: "var(--text-lo)" }}>{perTurn.toLocaleString()}</span></div>
                <div className="text-[11px] mt-2.5 leading-relaxed" style={{ color: pricey ? "var(--danger)" : "var(--text-lo)" }}>
                  Narrator: <span className="font-mono">{nm}</span> — runs every turn ({narrTok.toLocaleString()} tokens, {Math.round(narrTok / Math.max(stats.tokens, 1) * 100)}% of all usage).
                  {pricey ? " This is a premium model; cost adds up fast at this volume. A cheaper narrator in Tuning cuts most of the spend." : ""}
                </div>
                <div className="text-[10.5px] mt-1.5" style={{ color: "var(--text-lo)" }}>
                  See live billing at openrouter.ai/activity — Weft tracks token counts, not prices.
                </div>
              </>
            );
          })()}
        </div>
      </Fade>
      <Fade delay={0.05}>
        <div className="grid grid-cols-2 gap-2.5">
          <Stat label="Turns" value={String(stats.turns)} sub={save.world.current_time} />
          <Stat label="Words lived" value={stats.words.toLocaleString()} sub={`${Math.round(stats.words / Math.max(stats.turns, 1))}/turn`} />
          <Stat label="Tokens spent" value={stats.tokens.toLocaleString()} sub={`${Math.round(stats.tokens / Math.max(stats.turns, 1)).toLocaleString()}/turn`} />
          <Stat label="Avg pressure" value={stats.avgPressure.toFixed(1)} sub={`peak ${stats.peak?.pressure ?? 0} @ t${stats.peak?.turn ?? "—"}`} />
        </div>
      </Fade>

      <Fade delay={0.05}>
        <div className="card p-4">
          <Title>Pressure across the chronicle</Title>
          <Seismograph trace={stats.pressures} overlay={tel.map((t) => t.lyapunov ?? -0.2)} max={Math.max(stats.pressures.length, 24)} h={44} />
          <div className="flex gap-px mt-2 rounded overflow-hidden" style={{ height: 5 }}>
            {tel.map((t, i) => (
              <div key={i} className="flex-1" style={{ background: t.regime === "cascading" ? "var(--danger)" : t.regime === "critical" ? "var(--accent)" : "var(--ink-3)" }} />
            ))}
          </div>
          <Note>Bars: pressure. Hairline: λ̂, the world's sensitivity to perturbation. Strip: regime per turn — green-grey absorbs, amber is taut, red cascades.</Note>
        </div>
      </Fade>

      <Fade delay={0.1}>
        <div className="card p-4">
          <Title>Your inner weather</Title>
          <MoodArc values={stats.moods} />
          <Note>Mood valence per turn, −10 to +10. The line above the dashes is the good days.</Note>
        </div>
      </Fade>

      {stats.bonds.length > 0 && (
        <Fade delay={0.15}>
          <div className="card p-4">
            <Title>Bonds in motion</Title>
            <div className="space-y-2.5 mt-1">
              {stats.bonds.map(([id, vals]) => {
                const delta = vals[vals.length - 1] - vals[0];
                return (
                  <div key={id} className="flex items-center gap-3">
                    <div className="w-24 truncate text-[13px]">{name(id)}</div>
                    <div className="flex-1"><Sparkline values={vals} w={170} h={26} yMin={-100} yMax={100}
                      stroke={delta >= 0 ? "var(--calm)" : "var(--danger)"} fill /></div>
                    <div className="font-mono text-[10.5px] w-10 text-right" style={{ color: delta >= 0 ? "var(--calm)" : "var(--danger)" }}>
                      {delta >= 0 ? "+" : ""}{Math.round(delta)}
                    </div>
                  </div>
                );
              })}
            </div>
            <Note>How others' warmth toward you moved. They remember why.</Note>
          </div>
        </Fade>
      )}

      {arcs.length > 0 && (
        <Fade delay={0.18}>
          <div className="card p-4">
            <Title>Arcs — how people changed</Title>
            <div className="space-y-4 mt-1">
              {arcs.map((a) => (
                <div key={a.id} className="pb-3" style={{ borderBottom: "1px solid var(--line)" }}>
                  <div className="flex items-center gap-2.5">
                    {a.c.portrait_url && <img src={a.c.portrait_url} alt="" className="w-8 h-8 rounded-lg object-cover" style={{ border: "1px solid var(--line)" }} />}
                    <div className="flex-1 min-w-0">
                      <div className="font-display text-[15px]">{a.c.name}</div>
                      <div className="font-mono text-[9.5px]" style={{ color: "var(--text-lo)" }}>
                        {a.scenes} scenes{a.psy ? ` · now ${nice(a.psy.mood)}` : ""}{a.psy && a.psy.state !== "intact" ? ` · ${nice(a.psy.state)}` : ""}
                      </div>
                    </div>
                    {a.warmth.length >= 2 && (
                      <div className="text-right">
                        <Sparkline values={a.warmth} w={84} h={24} yMin={-100} yMax={100}
                          stroke={a.warmth[a.warmth.length - 1] >= a.warmth[0] ? "var(--calm)" : "var(--danger)"} fill />
                        <div className="font-mono text-[8.5px]" style={{ color: "var(--text-lo)" }}>warmth → you</div>
                      </div>
                    )}
                  </div>
                  {a.traits.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {a.traits.slice(0, 3).map((t) => (
                        <span key={t.id} className="chip" style={{ textTransform: "none", letterSpacing: 0 }}>
                          {niceCap(t.label)} ×{t.reinforcement_count}
                        </span>
                      ))}
                    </div>
                  )}
                  {a.beliefs.map((b, i) => (
                    <div key={i} className="text-[12px] mt-1.5" style={{ color: "var(--accent)" }}>※ {b.content}</div>
                  ))}
                  {a.heaviest && (
                    <div className="text-[12px] italic mt-1.5 leading-relaxed" style={{ color: "var(--text-mid)" }}>
                      What they carry heaviest: "{a.heaviest.content}" <span className="font-mono text-[9px]" style={{ color: "var(--text-lo)" }}>t{a.heaviest.turn}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Fade>
      )}

      {records.length > 0 && (
        <Fade delay={0.2}>
          <div className="card p-4">
            <Title>Records of this chronicle</Title>
            <div className="space-y-2 mt-1">
              {records.map((r) => (
                <div key={r.label} className="flex gap-3 items-baseline">
                  <span className="font-mono text-[9.5px] uppercase tracking-wider shrink-0 w-28" style={{ color: "var(--accent)" }}>{r.label}</span>
                  <span className="text-[12.5px]" style={{ color: "var(--text-mid)" }}>{r.value}</span>
                </div>
              ))}
            </div>
          </div>
        </Fade>
      )}

      {stats.screenTime.length > 0 && (
        <Fade delay={0.22}>
          <div className="card p-4">
            <Title>Who shared your scenes</Title>
            <Bars data={stats.screenTime} />
          </div>
        </Fade>
      )}

      <Fade delay={0.25}>
        <div className="card p-4">
          <Title>Things to know about the game you've been playing</Title>
          <div className="space-y-2 mt-1">
            {facts.map((f, i) => (
              <div key={i} className="text-[13px] leading-relaxed flex gap-2">
                <span style={{ color: "var(--accent)" }}>✧</span>
                <span style={{ color: "var(--text-mid)" }}>{f}</span>
              </div>
            ))}
          </div>
        </div>
      </Fade>
    </div>
  );
}

function Fade({ delay, children }: { delay: number; children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}>
      {children}
    </motion.div>
  );
}
function Title({ children }: { children: React.ReactNode }) {
  return <div className="font-mono text-[10px] uppercase tracking-widest mb-2.5" style={{ color: "var(--text-lo)" }}>{children}</div>;
}
function Note({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] italic mt-2" style={{ color: "var(--text-lo)" }}>{children}</div>;
}
