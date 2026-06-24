import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Send, Clock, Flag, Loader2 } from "lucide-react";
import { api, streamTurn, type ClientSave, type InterviewReport } from "../lib/api";
import { computeTiming } from "../engine/interview-timing";

/** Split narrator prose into paragraphs (matches the engine's double-newline convention). */
function Prose({ text }: { text: string }) {
  return <>{text.split(/\n{2,}/).map((p, i) => <p key={i} className="mb-3">{p}</p>)}</>;
}

function mmss(s: number): string {
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function Assessment({ save, setSave, onGraded }: {
  save: ClientSave;
  setSave: (s: ClientSave) => void;
  onGraded: (report: InterviewReport, save: ClientSave) => void;
}) {
  const cfg = save.interview!;
  const [action, setAction] = useState("");
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [liveProse, setLiveProse] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [grading, setGrading] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(() => {
    const started = save.interview_clock_started_ms;
    if (started == null) return null;
    const paused = save.interview_clock_paused_ms ?? 0;
    const elapsed = (Date.now() - started - paused) / 1000;
    return Math.max(0, Math.round(cfg.time_budget.total_seconds - elapsed));
  });
  const [started, setStarted] = useState(save.interview_clock_started_ms != null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const shownAtRef = useRef<number>(Date.now());        // when the current message finished rendering
  const typingStartRef = useRef<number | null>(null);   // first keystroke after a message
  const taRef = useRef<HTMLTextAreaElement>(null);
  // clock-pause accounting: the countdown must NOT run while the engine is processing
  // (the candidate physically can't act), so we accumulate paused time and subtract it.
  const pausedTotalRef = useRef<number>(save.interview_clock_paused_ms ?? 0);
  const pauseStartRef = useRef<number | null>(null);

  const history = save.history;
  const startedMs = save.interview_clock_started_ms ?? null;

  // arm timing for the next response whenever the visible message changes
  const armTiming = () => { shownAtRef.current = Date.now(); typingStartRef.current = null; };
  useEffect(() => { armTiming(); }, [history.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [liveProse, history.length, phase]);

  // paused-aware remaining time: subtract any time spent while the engine was processing.
  const remaining = (nowMs = Date.now()): number => {
    if (startedMs == null) return cfg.time_budget.total_seconds;
    const livePause = pauseStartRef.current != null ? nowMs - pauseStartRef.current : 0;
    const elapsed = (nowMs - startedMs - pausedTotalRef.current - livePause) / 1000;
    return Math.max(0, Math.round(cfg.time_budget.total_seconds - elapsed));
  };

  // the locked clock — tick every second once started; pauses while running OR grading; lock + auto-grade at zero
  useEffect(() => {
    if (!started || startedMs == null || grading) return;
    const tick = () => {
      const left = remaining();
      setSecondsLeft(left);
      if (left <= 0 && !running) endAndGrade();
    };
    tick();
    const h = setInterval(tick, 1000);
    return () => clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, startedMs, running, grading]);

  const expired = started && secondsLeft != null && secondsLeft <= 0;
  const lastShownText = useMemo(() => {
    const lastTurn = history.filter((h) => h.kind !== "opening").slice(-1)[0];
    return lastTurn?.narrator_prose ?? cfg.opening_message;
  }, [history, cfg.opening_message]);

  const onFirstKeystroke = () => { if (typingStartRef.current == null) typingStartRef.current = Date.now(); };

  async function endAndGrade() {
    if (grading) return;
    setGrading(true); setError(null);
    try {
      const { report, save: updated } = await api.gradeInterview(save.id);
      onGraded(report, updated);
    } catch (e: any) {
      setError(e?.message ?? "grading failed");
      setGrading(false);
    }
  }

  async function submit() {
    const a = action.trim();
    if (!a || running || grading) return;

    // start the locked clock on the very first response
    let clockMs = startedMs;
    if (clockMs == null) {
      clockMs = await api.startClock(save.id);
      setStarted(true);
      setSecondsLeft(cfg.time_budget.total_seconds);
    }

    // hard boundary: if the clock already expired (paused-aware), grade now
    if (remaining() <= 0) { await endAndGrade(); return; }

    // measure timing for this response
    const now = Date.now();
    const typingMs = now - (typingStartRef.current ?? now);
    const latencyMs = (typingStartRef.current ?? now) - shownAtRef.current;
    const incomingWords = lastShownText ? lastShownText.trim().split(/\s+/).length : 0;
    const timing = computeTiming({
      turn: save.world.current_turn, text: a, incomingWords,
      latencyMs: Math.max(0, latencyMs), typingMs: Math.max(0, typingMs), budget: cfg.time_budget,
    });
    await api.recordTiming(save.id, timing);

    // PAUSE the countdown — the candidate can't act while the engine computes.
    pauseStartRef.current = Date.now();
    setAction(""); setError(null); setRunning(true); setLiveProse(""); setPhase("reading the room");
    let failed = false;
    try {
      await streamTurn(save.id, a, "do", {
        onPhase: setPhase,
        onDelta: (t) => setLiveProse((p) => p + t),
        onDone: (s) => { setSave(s); setLiveProse(""); setPhase(null); armTiming(); },
        onError: (msg) => { setError(msg); failed = true; },
      });
    } catch (e: any) {
      if (e.name !== "AbortError") { setError(e.message ?? "turn failed"); failed = true; }
    } finally {
      // RESUME the countdown: bank the paused interval, persist it, unlock input.
      if (pauseStartRef.current != null) {
        pausedTotalRef.current += Date.now() - pauseStartRef.current;
        pauseStartRef.current = null;
        api.recordPause(save.id, pausedTotalRef.current).catch(() => {});
      }
      setRunning(false); setPhase(null);
      if (failed) setAction(a);
      // re-check the clock after the turn resolves (paused-aware)
      if (remaining() <= 0) endAndGrade();
    }
  }

  const lowTime = secondsLeft != null && secondsLeft <= 60;
  const locked = expired || grading;

  return (
    <div className="h-full flex flex-col">
      {/* clock + end bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2 text-[13px]" style={{ color: running ? "var(--text-lo)" : lowTime ? "#c07a6a" : "var(--text-mid)" }}>
          <Clock size={14} />
          {started && secondsLeft != null
            ? <span className="font-mono">{mmss(secondsLeft)}{running ? " · paused" : ""}</span>
            : <span className="italic">clock starts when you reply</span>}
        </div>
        <button onClick={endAndGrade} disabled={grading || !started}
          className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)", opacity: started ? 1 : 0.5 }}>
          <Flag size={12} /> {grading ? "grading…" : "end & grade"}
        </button>
      </div>

      {/* transcript */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 sm:px-8 py-5">
        <div className="max-w-2xl mx-auto">
          {/* situation framing */}
          {cfg.opening_situation && (
            <div className="mb-5 rounded-lg p-3.5 text-[13px]" style={{ background: "var(--surface-1)", border: "1px solid var(--border)", color: "var(--text-mid)" }}>
              {cfg.opening_situation}
            </div>
          )}

          {history.map((h, i) => (
            <div key={i} className="mb-5">
              {h.player_action && (
                <div className="mb-3 flex justify-end">
                  <div className="rounded-2xl rounded-br-sm px-3.5 py-2 max-w-[80%] text-[14px]" style={{ background: "var(--accent)", color: "var(--bg)" }}>
                    {h.player_action}
                  </div>
                </div>
              )}
              {h.narrator_prose && (
                <div className="prose-body text-[15px] leading-relaxed" style={{ color: "var(--text-hi)" }}>
                  <Prose text={h.narrator_prose} />
                </div>
              )}
            </div>
          ))}

          {liveProse && (
            <div className="prose-body text-[15px] leading-relaxed" style={{ color: "var(--text-hi)" }}>
              <Prose text={liveProse} />
            </div>
          )}

          <AnimatePresence>
            {running && (
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="flex items-center gap-2.5 py-3">
                <div className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <motion.span key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }}
                      animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
                      transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.18 }} />
                  ))}
                </div>
                <span className="text-[12.5px] italic" style={{ color: "var(--text-mid)" }}>
                  {liveProse ? "the room is responding…" : `${phase ?? "the room is reacting"}… (the clock is paused — you can't reply yet)`}
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {error && <div className="text-[13px] py-2" style={{ color: "#c07a6a" }}>{error}</div>}

          {locked && (
            <div className="mt-4 rounded-lg p-4 text-[13px]" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
              <div className="font-display mb-1">{grading ? "Grading your assessment…" : "Time's up."}</div>
              <div style={{ color: "var(--text-mid)" }}>{cfg.end_state_note || "The assessment is complete."}</div>
            </div>
          )}
        </div>
      </div>

      {/* input */}
      <div className="px-4 py-3 border-t" style={{ borderColor: "var(--border)" }}>
        <div className="max-w-2xl mx-auto flex items-end gap-2">
          <textarea
            ref={taRef}
            value={action}
            disabled={locked || running}
            onChange={(e) => { onFirstKeystroke(); setAction(e.target.value); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            rows={1}
            placeholder={locked ? "assessment ended" : running ? "the room is reacting — wait for the reply…" : "Respond as the manager…"}
            className="flex-1 resize-none rounded-xl px-3.5 py-2.5 text-[14px] max-h-40 transition-opacity"
            style={{ background: "var(--surface-1)", border: "1px solid var(--border)", color: "var(--text-hi)", opacity: running ? 0.55 : 1, cursor: running ? "not-allowed" : "text" }}
          />
          <motion.button whileTap={{ scale: 0.92 }} onClick={submit} disabled={locked || running || !action.trim()}
            className="shrink-0 rounded-xl p-2.5" style={{ background: "var(--accent)", color: "var(--bg)", opacity: (locked || running || !action.trim()) ? 0.4 : 1 }}>
            {running ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </motion.button>
        </div>
      </div>
    </div>
  );
}
