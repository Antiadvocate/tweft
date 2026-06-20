/**
 * The turn loop. Per turn:
 *   0. pushSnapshot (rollback ring)
 *   1. decidePressure        — deterministic, 0 tokens (was: Threat Director call)
 *   2. NARRATOR              — streamed, cache-aligned prefix  [LLM call 1]
 *   3. SIMULATOR             — one strict-JSON diff merging the old Bookkeeper,
 *                              World Tick and memory-writer    [LLM call 2]
 *   4. apply diff + deterministic systems: psyche drift, trait decay,
 *      rumor diffusion, drive ticks, clock/consequence bookkeeping — 0 tokens
 *   5. reflection (every R turns, importance-gated)            [occasional small call]
 */
import type { ActionMode, SaveState, SimulatorDiff, TurnTelemetry, Belief } from "./types";
import { decidePressure, isDue, pressureDirective } from "./pressure";
import { narratorSystem, simulatorSystem, REFLECTION_SYSTEM, simulatorSchemaHint, stablePrefix, volatileDigest } from "./prompts";
import { buildMessages, complete, completeStream, safeJson } from "../llm";
import { advance, heuristicMinutes } from "./time";
import { applyEdgeDelta, capMemory, consolidateBackground, consolidateTraits, decayTraits, diffuseRumors, needsHistoryCompaction, reinforceOrMergeTrait, tickDrives, playerEdgeSnapshot } from "./social";
import { regenerateDrives, seedDrive } from "./drives";
import { reflectionDue, applyReflection } from "./memory";
import { tickUndertow } from "./undertow";
import { pushSnapshot, registerCharacter, uid } from "./state";

export interface TurnEvents {
  onPhase: (phase: string) => void;
  onDelta: (text: string) => void;
  onMeta: (meta: object) => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function emptyDiff(): SimulatorDiff {
  return {
    scene_summary: "", elapsed_minutes: 20, facts: [], psyche: [], edges: [], memories: [], appearance: [], drives_update: [],
    traits: [], threads_update: [], rumors_new: [], consequences_new: [], clocks_advance: [],
    new_characters: [], new_places: [], offscreen: [],
  };
}

const INLINE_CHANNEL_NOTE = `\n[How to read the player's input: text in "double quotes" is spoken ALOUD and others can hear it; text in *asterisks* is a PRIVATE THOUGHT that NO ONE in the scene can perceive, react to, or know — not even by intuition; everything else is physical action the player takes. Honor these channels exactly: never let a character respond to or act on a thought in *asterisks*, and never have someone "overhear" something the player only thought. If the player mixes them in one message, treat each part on its own channel.]`;

const MODE_FRAME: Record<ActionMode, (a: string) => string> = {
  do: (a) => `${a}${/\*/.test(a) ? INLINE_CHANNEL_NOTE : ""}`,
  say: (a) => `The player speaks aloud, in their own voice: "${a}"`,
  think: (a) => `PRIVATE INTERIOR — the player's unspoken thought, sensed by NO ONE: ${a}\nThis is internal only. The player did NOT say or do this. No character can hear it, react to it, or know it — not even characters present, not even by intuition. Do NOT have anyone respond to it or act on its content. Render only the player's own private experience of the thought and, if anything, what is already happening around them; the thought itself changes nothing others perceive.`,
  story: (a) => `The player narrates what happens next (treat as authorial intent, weave it in, keep the world's logic): ${a}`,
};

/** A proper name (multi-word, or Capitalized non-generic) — used only as a hint for auto-tracking. */
function looksNamed(name: string): boolean {
  const generic = /^(the |a |an )?(guard|thug|man|woman|figure|stranger|officer|cop|patron|crowd|bystander|clerk|driver|waiter|nurse|soldier|guy|girl|boy|kid|person|someone)s?$/i;
  if (generic.test(name.trim())) return false;
  return /\s/.test(name.trim()) || /^[A-Z]/.test(name.trim());
}

export async function runTurn(state: SaveState, action: string, ev: TurnEvents, mode: ActionMode = "do", opts?: { ground?: boolean }): Promise<void> {
  const t0 = Date.now();
  const framedAction = MODE_FRAME[mode](action);
  const turn = state.world.current_turn;
  pushSnapshot(state);

  // 1 ── the undertow turns first: strategy, chaos, catastrophe (deterministic, 0 tokens)
  ev.onPhase("undertow");
  const undertow = tickUndertow(state);

  // 1b ── pressure (deterministic), heat amplified when the world is primed
  ev.onPhase("pressure");
  const verdict = decidePressure({
    turn, now: state.world.current_time, trace: state.pressure_trace, difficulty: state.world_bible.difficulty_profile,
    threads: state.world.threads, consequences: state.world.consequences, clocks: state.world.clocks, action,
    instability: undertow.instability,
    focusMode: state.world.focus?.mode ?? null, focusLabel: state.world.focus?.label ?? null,
    tension: state.model_settings.tension ?? 5,
  });
  state.pressure_trace.push(verdict.pressure);
  ev.onMeta({ pressure: verdict.pressure, band: verdict.band, source: verdict.source });

  // 2 ── narrator (streamed)
  ev.onPhase("narrator");
  const prefix = stablePrefix(state);
  const digest = volatileDigest(state, action);
  let directive = pressureDirective(verdict, state.world_bible.pressure_palette, state.model_settings.tension ?? 5);
  const forbid = state.world_bible.forbidden_as_primary?.length
    ? `\nNever the primary engine of this scene: ${state.world_bible.forbidden_as_primary.join("; ")}.` : "";
  if (state.world_bible.god_mode) {
    directive += `\nGOD MODE — the player is sovereign here. Their powers succeed completely and cost NOTHING unless they narrate a cost themselves. Override any cost or limitation language in the world bible's magic rules for the player only. The world still reacts honestly: people fear, adapt, worship, scheme, flee, disbelieve. Pressure comes from the world's response to a god walking it, never from handicapping the god.`;
  }
  const fullDirective = directive + forbid + "\n" + undertow.directive;
  const groundNote = opts?.ground ? `\n\n=== GROUNDING (this turn) ===\nThis story is set in a real place / based on real subject matter. Use web search to get the real-world facts right — actual locations, layouts, names, how things really work, accurate period or setting detail — and weave that accuracy naturally into the prose. Do not cite sources or break the fiction; just be correct.` : "";
  const narratorMsgs = buildMessages(
    narratorSystem(state.model_settings.lean_mode), prefix,
    `${digest}\n\n=== DIRECTION ===\n${fullDirective}${groundNote}\n\n=== PLAYER ACTION (render exactly, add no interiority) ===\n${framedAction}`,
    state.model_settings.narrator_model,
  );
  const stream = completeStream(narratorMsgs, state.model_settings.narrator_model, state.model_settings.fallback_model, 4000, opts?.ground === true);
  let prose = "";
  let narratorUsage = { prompt_tokens: 0, completion_tokens: 0 };
  while (true) {
    const { done, value } = await stream.next();
    if (done) { prose = value.text; narratorUsage = value.usage; break; }
    ev.onDelta(value);
  }

  // 3 ── simulator (one JSON call: bookkeeper + world tick + memory writes)
  ev.onPhase("simulator");
  const simMsgs = buildMessages(
    simulatorSystem(state.model_settings.lean_mode) + "\n\n" + simulatorSchemaHint(), prefix,
    `${digest}\n\n=== PLAYER ACTION ===\n${framedAction}\n\n=== NARRATOR PROSE (source of truth) ===\n${prose}`,
    state.model_settings.simulator_model,
  );
  let simUsage = { prompt_tokens: 0, completion_tokens: 0 };
  let diff = emptyDiff();
  try {
    const res = await complete(simMsgs, state.model_settings.simulator_model, state.model_settings.fallback_model, true, 3000);
    simUsage = res.usage;
    diff = { ...emptyDiff(), ...safeJson<Partial<SimulatorDiff>>(res.text, {}) };
  } catch (e: any) {
    console.warn(`[turn] simulator failed entirely: ${e.message} — applying heuristics only`);
  }

  // 4 ── apply diff + deterministic systems
  ev.onPhase("apply");
  const shifts = applyDiff(state, diff, action, prose);
  shifts.push(...undertow.snaps);
  if (undertow.regime === "cascading") shifts.push("The world is primed — small things cascade.");
  const offscreenLog = [...(diff.offscreen ?? [])];
  offscreenLog.push(...undertow.snaps);
  offscreenLog.push(...undertow.stances.slice(0, 3).map((st) => `${st.name} ${st.stance === "press" ? "presses" : st.stance === "maneuver" ? "maneuvers" : st.stance === "hold" ? "holds position" : "yields ground"} against ${st.vs} (quantal p=${st.p.toFixed(2)})`));
  // present, named characters the player is actually engaging join the long game
  for (const id of state.world.present) {
    const c = state.characters[id];
    if (c && id !== "char_player" && !c.tracked && looksNamed(c.name)) c.tracked = true;
  }
  offscreenLog.push(...tickDrives(state));   // completion events (progress already moved by QRE stances)
  if ((state.model_settings.tension ?? 5) > 0) offscreenLog.push(...regenerateDrives(state)); // tracked + idle → a fresh want; suppressed entirely at tension 0
  offscreenLog.push(...diffuseRumors(state));
  for (const id of Object.keys(state.characters)) {
    // conditions decay for EVERYONE incl. the player — a nosebleed is not a life sentence
    const cc = state.condition[id];
    cc.condition_age ??= {};
    const expired = cc.conditions.filter((x) => turn - (cc.condition_age![x] ?? turn) >= CONDITION_LIFESPAN);
    if (expired.length) {
      cc.conditions = cc.conditions.filter((x) => !expired.includes(x));
      for (const x of expired) delete cc.condition_age![x];
      offscreenLog.push(`${state.characters[id].name}: ${expired.map((e) => e.toLowerCase()).join(", ")} — faded.`);
    }
    if (id === "char_player") continue;
    const { kept, log } = decayTraits(state.traits[id] ?? [], turn);
    state.traits[id] = kept;
    offscreenLog.push(...log.map((l) => `${state.characters[id].name}: ${l}`));
    // earned identity change: only on the reflection cadence, never per-turn
    if (reflectionDue(state.memory[id], state.model_settings.reflection_cadence, turn)) {
      const { kept: ck, log: clog } = consolidateTraits(state.characters[id], state.traits[id], turn);
      state.traits[id] = ck;
      for (const l of clog) { offscreenLog.push(l); shifts.push(l); }
      // identity-defining memories fold permanently into background (survive eviction, shape who they are)
      const blog = consolidateBackground(state.characters[id], state.memory[id]);
      for (const l of blog) { offscreenLog.push(l); shifts.push(l); }
    }
  }
  for (const id of Object.keys(state.condition)) {
    const ps = state.condition[id].psyche;
    ps.mood_valence = Math.round(ps.relaxation);
  }
  // fired consequences retire
  for (const c of state.world.consequences) if (isDue(c, turn, state.world.current_time) && verdict.due_consequence?.id === c.id) c.status = "fired";

  // PHASE auto-advance: when the event a build-phase was converging on actually fires,
  // the phase becomes the next one (e.g. "prepare for war" → "fighting the war"), flipping the
  // tension default from suppressed to hot — generically, driven by the consequence, not by words.
  const focus = state.world.focus;
  if (focus?.linked_consequence_id) {
    const linked = state.world.consequences.find((c) => c.id === focus.linked_consequence_id);
    if (linked && linked.status === "fired") {
      if (focus.next_label) {
        state.world.focus = { label: focus.next_label, mode: focus.next_mode ?? "active" };
        shifts.push(`The phase turns: now ${focus.next_label}.`);
      } else {
        state.world.focus = null;   // the event passed and there's no next phase — release focus
      }
    }
  }
  // fired clocks
  for (const c of state.world.clocks) if (c.status === "running" && c.filled >= c.segments) c.status = "fired";

  // history + time
  const minutes = diff.elapsed_minutes > 0 ? clamp(diff.elapsed_minutes, 1, 12 * 60) : heuristicMinutes(action, prose);
  state.world.current_time = advance(state.world.current_time, minutes);
  state.history.push({
    turn, player_action: action, action_mode: mode, narrator_prose: prose,
    summary: diff.scene_summary || prose.slice(0, 120),
    shifts: shifts.slice(0, 8), weather: state.world.weather, directive: fullDirective,
    offscreen: offscreenLog.slice(0, 6), time_label: state.world.current_time,
  });

  // 5 ── reflection (occasional, importance-gated)
  let reflectionTokens = 0;
  for (const id of Object.keys(state.memory)) {
    const mem = state.memory[id];
    if (!reflectionDue(mem, state.model_settings.reflection_cadence, turn)) continue;
    ev.onPhase("reflection");
    try {
      const recent = mem.episodic.slice(-20).map((m) => `[T${m.turn}, imp ${m.importance}] ${m.content}`).join("\n");
      const msgs = [
        { role: "system", content: REFLECTION_SYSTEM },
        { role: "user", content: `Character: ${state.characters[id]?.name}\nExisting beliefs: ${mem.beliefs.map((b) => b.content).join(" | ") || "none"}\nRecent memories:\n${recent}` },
      ];
      const res = await complete(msgs, state.model_settings.simulator_model, state.model_settings.fallback_model, true, 600);
      reflectionTokens += res.usage.prompt_tokens + res.usage.completion_tokens;
      const parsed = safeJson<{ beliefs: { content: string; confidence: number }[] }>(res.text, { beliefs: [] });
      const beliefs: Belief[] = parsed.beliefs.slice(0, 3).map((b) => ({ content: b.content, confidence: clamp(b.confidence ?? 0.7, 0, 1), formed_turn: turn, evidence_turns: [] }));
      if (beliefs.length) applyReflection(mem, beliefs, turn);

      // history compaction: when the accreted life_history has grown long, re-summarize it into
      // tighter prose (preserve the throughline, lose verbatim detail). Bedrock background untouched.
      const ident = state.characters[id];
      if (ident && needsHistoryCompaction(ident)) {
        try {
          const cmsg = [
            { role: "system", content: `You compress a character's accumulated life-history into tighter prose. Preserve every identity-defining throughline (relationships formed, who they became, irreversible changes, key losses and bonds) but collapse repetitive or minor beats and lose verbatim detail. Keep it under 120 words, past tense, plain prose, no list. Output ONLY the rewritten history paragraph.` },
            { role: "user", content: `Character: ${ident.name}\nTheir core identity (do NOT repeat this, it's already known): ${ident.background}\nAccumulated history to compress:\n${ident.life_history}` },
          ];
          const cres = await complete(cmsg, state.model_settings.simulator_model, state.model_settings.fallback_model, false, 300);
          reflectionTokens += cres.usage.prompt_tokens + cres.usage.completion_tokens;
          const tightened = cres.text.trim();
          if (tightened && tightened.length < (ident.life_history?.length ?? 0)) {
            ident.life_history = tightened;
            shifts.push(`${ident.name}'s long history settled into its essentials.`);
          }
        } catch (e: any) {
          // if the rewrite fails, fall back to a hard tail-trim so it can't grow unbounded
          if (ident.life_history && ident.life_history.length > 1400) ident.life_history = ident.life_history.slice(-1400);
        }
      }
    } catch (e: any) {
      console.warn(`[turn] reflection failed for ${id}: ${e.message}`);
    }
  }

  // telemetry
  const tel: TurnTelemetry = {
    turn, pressure: verdict.pressure, pressure_source: verdict.source,
    narrator_tokens_in: narratorUsage.prompt_tokens, narrator_tokens_out: narratorUsage.completion_tokens,
    simulator_tokens_in: simUsage.prompt_tokens, simulator_tokens_out: simUsage.completion_tokens,
    reflection_tokens: reflectionTokens, duration_ms: Date.now() - t0,
    word_count: prose.split(/\s+/).filter(Boolean).length,
    player_mood_valence: state.condition["char_player"]?.psyche.mood_valence ?? 0,
    present: [...state.world.present], time_label: state.world.current_time,
    edge_snapshot: playerEdgeSnapshot(state),
    lyapunov: undertow.lyapunov, coherence: undertow.coherence,
    regime: undertow.regime, early_warning: undertow.early_warning,
  };
  state.telemetry.push(tel);
  state.world.current_turn++;
  ev.onMeta({ telemetry: tel, offscreen: offscreenLog.slice(0, 6), shifts: shifts.slice(0, 8), weather: state.world.weather, time: state.world.current_time });
}

const TRANSIENT_RE = /\b(currently|right now|at the moment|for now|bleeding|blood(y|ied)?|nosebleed|fatigued?|exhausted|tears?|crying|sweat(ing)?|panting|trembling|shaking|wincing|sedat\w*|bandag\w*|restrained)\b/i;

/** Appearance is identity, not status. Strip sentences describing transient state. */
export function stripTransient(value: string): string {
  const kept = value
    .split(/(?<=[.;!?])\s+/)
    .filter((sent) => !TRANSIENT_RE.test(sent));
  return kept.join(" ").trim();
}

function wordOverlap(a: string, b: string): boolean {
  const STOP = new Set(["the","a","an","of","in","on","and","with","from","severe","slowly","slow","heavy","mild","light"]);
  const wa = a.toLowerCase().split(/\W+/).filter((w) => w.length > 3 && !STOP.has(w));
  const wb = b.toLowerCase().split(/\W+/).filter((w) => w.length > 3 && !STOP.has(w));
  return wb.some((w) => wa.some((x) => x === w || x.startsWith(w) || w.startsWith(x)));
}

/** Add a condition with dedupe: a variant of an existing condition REPLACES it instead of stacking. */
export function addCondition(c: { conditions: string[]; condition_age?: Record<string, number> }, value: string, turn: number): void {
  if (!value) return;
  c.condition_age ??= {};
  const dup = c.conditions.find((x) => x.toLowerCase() === value.toLowerCase() || wordOverlap(x, value));
  if (dup) {
    delete c.condition_age[dup];
    c.conditions = c.conditions.filter((x) => x !== dup);
  }
  c.conditions.push(value);
  c.condition_age[value] = turn;
  // hard cap: oldest fall off
  while (c.conditions.length > 6) {
    const oldest = c.conditions.reduce((m, x) => ((c.condition_age![x] ?? 0) < (c.condition_age![m] ?? 0) ? x : m), c.conditions[0]);
    c.conditions = c.conditions.filter((x) => x !== oldest);
    delete c.condition_age[oldest];
  }
}

const CONDITION_LIFESPAN = 10; // turns; afflictions heal unless re-earned

function findCharByName(state: SaveState, name: string): string | null {
  const n = name.toLowerCase().trim();
  for (const [id, c] of Object.entries(state.characters)) if (c.name.toLowerCase() === n) return id;
  for (const [id, c] of Object.entries(state.characters)) if (c.name.toLowerCase().includes(n) || n.includes(c.name.toLowerCase())) return id;
  return null;
}

function resolveId(state: SaveState, ref: string): string | null {
  if (!ref) return null;
  if (state.characters[ref]) return ref;
  return findCharByName(state, ref);
}

/** Find a place by id or (case-insensitive) name; create it on first mention. Returns the place id. */
export function resolvePlace(state: SaveState, ref: string): string {
  if (!ref) return state.world.player_location;
  if (state.world.places[ref]) return ref;
  const byName = Object.values(state.world.places).find((p) => p.name.toLowerCase() === ref.trim().toLowerCase());
  if (byName) return byName.id;
  const id = uid("loc");
  state.world.places[id] = { id, name: ref.trim(), description_facts: "", contains: [] };
  return id;
}

/** present is DERIVED: whoever shares the player's place is in the scene. Rebuilds every place's
 *  occupancy from each character's location. A `hint` (the diff's `present`) only nudges defaults
 *  for characters who don't yet have a location set. */
export function syncPresence(state: SaveState, hint?: string[]): void {
  const ploc = state.world.player_location;
  // seed locations for anyone the narrator named as present but who has no place yet
  if (hint) {
    for (const ref of hint) {
      const id = resolveId(state, ref);
      if (id && id !== "char_player" && !state.characters[id].location) state.characters[id].location = ploc;
    }
  }
  state.characters["char_player"].location = ploc;
  // rebuild contains[] from the source of truth (each character's location); the gone don't occupy rooms
  for (const p of Object.values(state.world.places)) p.contains = [];
  for (const [id, c] of Object.entries(state.characters)) {
    if (c.status === "dead" || c.status === "departed") continue;
    if (c.location && state.world.places[c.location]) state.world.places[c.location].contains.push(id);
  }
  // the scene = living, present non-player characters co-located with the player
  state.world.present = Object.entries(state.characters)
    .filter(([id, c]) => id !== "char_player" && c.location === ploc && c.status !== "dead" && c.status !== "departed")
    .map(([id]) => id);
}


export function applyDiff(state: SaveState, diff: SimulatorDiff, action: string, prose: string): string[] {
  const turn = state.world.current_turn;
  const shifts: string[] = [];
  const nameOf = (id: string) => state.characters[id]?.name ?? id;

  // MASTER TENSION DIAL — origination clamp. At tension 0 the engine introduces NOTHING new on its
  // own: no new consequences, no brand-new threads, no new faction clocks. The world still RESPONDS
  // (existing threads can resolve/shift, conditions heal, edges move, people react) — it just stops
  // manufacturing fresh trouble in the background. Low tension (1–2) also blocks new consequences.
  const tension = state.model_settings.tension ?? 5;
  if (tension <= 0) {
    diff = { ...diff,
      consequences_new: [],
      threads_update: (diff.threads_update ?? []).filter((t) => {
        const exists = state.world.threads.some((x) => x.id === t.id || x.title.toLowerCase() === t.title.toLowerCase());
        return exists; // allow updates/resolutions to existing threads, block brand-new ones
      }),
    } as SimulatorDiff;
  } else if (tension <= 2) {
    diff = { ...diff, consequences_new: [] } as SimulatorDiff;
  }

  // new characters & places first so later refs resolve
  for (const nc of diff.new_characters ?? []) {
    if (!nc?.name || findCharByName(state, nc.name)) continue;
    registerCharacter(state, { ...nc, character_id: undefined as any, gregariousness: clamp(nc.gregariousness ?? 0.5, 0, 1) });
  }
  for (const np of diff.new_places ?? []) {
    if (!np?.name) continue;
    const exists = Object.values(state.world.places).some((p) => p.name.toLowerCase() === np.name.toLowerCase());
    if (!exists) {
      const id = uid("loc");
      state.world.places[id] = { id, name: np.name, description_facts: np.description_facts ?? "", contains: [] };
    }
  }

  if (diff.weather) state.world.weather = diff.weather;
  if (diff.money) state.world.money = diff.money;

  // ── LOCATION: the bookkeeper records where everyone is. Places auto-resolve by
  //    id or name and are created on first mention (incl. "in-between" places like
  //    "walking outside the dome"). present is DERIVED from co-location, never authored. ──
  if (diff.player_location) {
    state.world.player_location = resolvePlace(state, diff.player_location);
    state.characters["char_player"].location = state.world.player_location;
  }
  for (const mv of diff.locations ?? []) {
    const cid = resolveId(state, mv.char_id);
    if (!cid || !mv.place) continue;
    const fromPid = state.characters[cid].location;
    const pid = resolvePlace(state, mv.place);
    if (pid !== fromPid) {
      // a move is an event the character remembers: where from, where to, when
      const fromName = (fromPid && state.world.places[fromPid]?.name) || "elsewhere";
      const toName = state.world.places[pid]?.name ?? mv.place;
      const mem = state.memory[cid];
      if (mem && fromPid) {
        mem.episodic.push({
          turn, content: `Left ${fromName} and went to ${toName}.`,
          importance: 4, emotional_charge: "", when_label: state.world.current_time, where: toName,
          last_accessed_turn: turn,
        });
        mem.episodic = capMemory(mem.episodic);
      }
    }
    state.characters[cid].location = pid;
    if (cid === "char_player") state.world.player_location = pid;
  }

  // ── EXITS: someone died or left the story for good. Mark them, pull them from the
  //    scene and any room, and stop the engine from seeding them new wants. ──
  for (const ex of diff.character_exits ?? []) {
    const cid = resolveId(state, ex.char_id);
    if (!cid || cid === "char_player") continue;
    const c = state.characters[cid];
    if (!c) continue;
    c.status = ex.kind;
    c.exit_turn = turn;
    if (ex.note) c.exit_note = ex.note;
    c.tracked = false;
    c.drive = undefined;
    c.drive_queue = [];
    // remove from whatever room held them
    const pid = c.location;
    if (pid && state.world.places[pid]) {
      state.world.places[pid].contains = state.world.places[pid].contains.filter((x) => x !== cid);
    }
    shifts.push(ex.kind === "dead" ? `${c.name} is dead.` : `${c.name} is gone.`);
  }

  syncPresence(state, diff.present);

  // a new standing quirk/interest the story earned (kept small; capped so it never becomes a list)
  for (const tx of diff.texture_add ?? []) {
    const cid = resolveId(state, tx.char_id);
    if (!cid || !tx.item?.trim()) continue;
    const c = state.characters[cid];
    c.texture ??= [];
    const item = tx.item.trim();
    if (!c.texture.some((t) => t.toLowerCase() === item.toLowerCase())) {
      c.texture.push(item);
      if (c.texture.length > 5) c.texture = c.texture.slice(-5);
    }
  }


  for (const f of diff.facts ?? []) {
    const id = resolveId(state, f.char_id); if (!id) continue;
    const c = state.condition[id]; if (!c) continue;
    switch (f.field) {
      case "fatigue": if (["fresh","tired","exhausted"].includes(f.value)) c.fatigue = f.value as any; break;
      case "hunger": if (["fed","peckish","hungry","starving"].includes(f.value)) c.hunger = f.value as any; break;
      case "condition_add": addCondition(c, f.value, turn); break;
      case "condition_remove": {
        const q = f.value.toLowerCase();
        c.conditions = c.conditions.filter((x) => {
          const keep = !(x.toLowerCase().includes(q) || q.includes(x.toLowerCase()) || wordOverlap(x, f.value));
          if (!keep) delete c.condition_age?.[x];
          return keep;
        });
        break;
      }
      case "inventory_add": if (f.value) c.inventory.push({ id: uid("itm"), name: f.value }); break;
      case "inventory_remove": c.inventory = c.inventory.filter((i) => i.name.toLowerCase() !== f.value.toLowerCase()); break;
      case "wearing_add": {
        if (!f.value) break;
        const v = f.value.toLowerCase();
        // drop any existing garment that shares a head noun (coat, jacket, dress…) so layers replace, not pile up
        const noun = (s: string) => (s.toLowerCase().match(/\b(coat|jacket|dress|shirt|gown|cloak|robe|suit|armor|armour|trousers|pants|boots|shoes|gloves|mask|hat)\b/)?.[1]) ?? "";
        const vn = noun(v);
        if (vn) c.wearing = c.wearing.filter((w) => noun(w) !== vn);
        if (!c.wearing.some((w) => w.toLowerCase() === v)) c.wearing.push(f.value);
        if (c.wearing.length > 10) c.wearing = c.wearing.slice(-10);
        break;
      }
      case "wearing_remove": {
        const v = (f.value || "").toLowerCase();
        c.wearing = c.wearing.filter((w) => { const lw = w.toLowerCase(); return lw !== v && !lw.includes(v) && !v.includes(lw); });
        break;
      }
      case "injury": if (f.value) c.injuries.push({ id: uid("inj"), type: f.value, cause: "this turn", permanent: false, functional_impact: f.value }); break;
      case "injury_remove": {
        const q = f.value.toLowerCase();
        c.injuries = c.injuries.filter((inj) => !(inj.type.toLowerCase().includes(q) || q.includes(inj.type.toLowerCase())));
        break;
      }
    }
  }

  for (const p of diff.psyche ?? []) {
    const id = resolveId(state, p.char_id); if (!id) continue;
    const c = state.condition[id]; if (!c) continue;
    c.psyche.relaxation = clamp(c.psyche.relaxation + clamp(p.relaxation_delta ?? 0, -6, 6), -10, 10);
    if (p.mood) c.psyche.mood = p.mood;
    for (const s of p.states_add ?? []) if (s && !c.psyche.active_states.includes(s)) c.psyche.active_states.push(s);
    for (const s of p.states_remove ?? []) c.psyche.active_states = c.psyche.active_states.filter((x) => x !== s);
    if (c.psyche.active_states.length > 5) c.psyche.active_states = c.psyche.active_states.slice(-5);
    const d = clamp(p.relaxation_delta ?? 0, -6, 6);
    if (id !== "char_player" && Math.abs(d) >= 3) shifts.push(d > 0 ? `${nameOf(id)} opened a little.` : `${nameOf(id)} clenched.`);
  }

  for (const e of diff.edges ?? []) {
    const from = resolveId(state, e.from), to = resolveId(state, e.to);
    if (!from || !to || from === to) continue;
    applyEdgeDelta(state.world.edges, { from, to, warmth_delta: e.warmth_delta ?? 0, trust_delta: e.trust_delta ?? 0, power_delta: e.power_delta ?? 0, note: e.note, roles_set: e.roles_set }, turn);
    if (to === "char_player") {
      const w = e.warmth_delta ?? 0, tr = e.trust_delta ?? 0;
      if (w <= -5) shifts.push(`${nameOf(from)} cooled toward you.`);
      else if (w >= 5) shifts.push(`${nameOf(from)} warmed toward you.`);
      if (tr <= -5) shifts.push(`${nameOf(from)} trusts you less.`);
      else if (tr >= 5) shifts.push(`${nameOf(from)} trusts you more.`);
    }
  }

  for (const m of diff.memories ?? []) {
    const id = resolveId(state, m.char_id); if (!id || !m.content) continue;
    const mem = state.memory[id]; if (!mem) continue;
    const wherePid = state.characters[id]?.location;
    mem.episodic.push({
      turn, content: m.content, importance: clamp(m.importance ?? 3, 1, 10),
      emotional_charge: m.emotional_charge ?? "", last_accessed_turn: turn,
      when_label: state.world.current_time,
      where: (wherePid && state.world.places[wherePid]?.name) || undefined,
      ...(m.scheduled_time ? { scheduled_time: m.scheduled_time, commitment_status: "pending" as const } : {}),
    });
    mem.episodic = capMemory(mem.episodic);
    if (id !== "char_player" && (m.importance ?? 3) >= 6) shifts.push(`${nameOf(id)} will remember that.`);
  }

  for (const cn of diff.canon_add ?? []) {
    if (!cn || state.world.canon.some((x) => x.toLowerCase() === cn.toLowerCase())) continue;
    state.world.canon.push(cn);
    if (state.world.canon.length > 20) state.world.canon.shift();
    for (const id of Object.keys(state.memory)) {
      state.memory[id].episodic.push({
        turn, content: `The world changed, and everyone knows it: ${cn}`,
        importance: 8, emotional_charge: "awe", last_accessed_turn: turn,
      });
    }
    shifts.push(`CANON: ${cn}`);
  }

  for (const a of diff.appearance ?? []) {
    const id = resolveId(state, a.char_id); if (!id || !a.value) continue;
    const cleaned = stripTransient(a.value);
    if (!cleaned) continue; // a purely transient "update" is not an identity change
    state.characters[id].appearance_facts = cleaned;
    shifts.push(`${nameOf(id)} is changed — the world will describe them as they are now.`);
  }

  // group drives_update by character; highest priority becomes active, rest become the queue (max 2)
  const drivesByChar = new Map<string, typeof diff.drives_update>();
  for (const du of diff.drives_update ?? []) {
    const id = resolveId(state, du.char_id); if (!id || id === "char_player" || !du.goal) continue;
    (drivesByChar.get(id) ?? drivesByChar.set(id, []).get(id)!).push(du);
  }
  for (const [id, dus] of drivesByChar) {
    const sorted = [...dus].sort((a, b) => (b.priority ?? 1) - (a.priority ?? 1));
    const mk = (d: typeof sorted[number]) => ({ goal: d.goal, progress: clamp(d.progress ?? 0, 0, 100), blocker: d.blocker, priority: d.priority ?? 1, updated_turn: turn });
    state.characters[id].drive = mk(sorted[0]);
    if (sorted.length > 1) state.characters[id].drive_queue = sorted.slice(1, 3).map(mk);
    state.characters[id].tracked = true;
    if (!sorted[0].progress) shifts.push(`${nameOf(id)} wants something new: ${sorted[0].goal}.`);
  }

  // the narrator can promote characters into the long game
  for (const tk of diff.track ?? []) {
    const id = resolveId(state, tk); if (!id || id === "char_player") continue;
    if (!state.characters[id].tracked) {
      state.characters[id].tracked = true;
      shifts.push(`${nameOf(id)} steps into the larger story.`);
    }
  }

  for (const t of diff.traits ?? []) {
    const id = resolveId(state, t.char_id); if (!id || id === "char_player" || !t.label) continue;
    reinforceOrMergeTrait(state.traits[id] ?? (state.traits[id] = []), t, turn);
    shifts.push(`Something is growing on ${nameOf(id)}: "${t.label}".`);
  }

  for (const tu of diff.threads_update ?? []) {
    if (!tu?.title) continue;
    const existing = state.world.threads.find((t) => t.id === tu.id || t.title.toLowerCase() === tu.title.toLowerCase());
    if (existing) {
      existing.status = tu.status;
      if (tu.description) existing.description = tu.description;
      if (typeof tu.tension === "number") existing.tension = clamp(tu.tension, 0, 10);
      if (tu.status === "resolved") existing.turn_resolved = turn;
    } else if (tu.status === "active") {
      state.world.threads.push({ id: uid("thr"), title: tu.title, status: "active", description: tu.description ?? "", turn_started: turn, tension: clamp(tu.tension ?? 3, 0, 10) });
      shifts.push(`A new thread: ${tu.title}.`);
    }
    if (existing && tu.status === "resolved") shifts.push(`Thread resolved: ${tu.title}.`);
  }

  for (const r of diff.rumors_new ?? []) {
    if (!r?.content) continue;
    const origin = resolveId(state, r.origin_char) ?? "char_player";
    state.world.rumors.push({
      id: uid("rum"), content: r.content, truth: r.truth ?? "true",
      salience: clamp(r.salience ?? 5, 1, 10), origin_char: origin,
      knowers: [origin, ...state.world.present.filter(() => Math.random() < 0.6)],
      born_turn: turn, about_char: r.about_char ? resolveId(state, r.about_char) ?? undefined : undefined,
    });
    if (state.world.rumors.length > 40) state.world.rumors = state.world.rumors.slice(-40);
    shifts.push(r.truth === "true" ? `A rumor is born.` : `A rumor is born — and it isn't true.`);
  }

  for (const c of diff.consequences_new ?? []) {
    if (!c?.description) continue;
    // prefer an in-world-time schedule: "in 2 days" must mean two days of story time, not two turns.
    const deltaMin = (c.fire_in_days ? c.fire_in_days * 1440 : 0) + (c.fire_in_hours ? c.fire_in_hours * 60 : 0);
    const fire_time = deltaMin > 0 ? advance(state.world.current_time, deltaMin) : undefined;
    state.world.consequences.push({
      id: uid("cq"), description: c.description,
      fire_turn: turn + Math.max(1, c.fire_in_turns ?? 1),   // a floor only
      fire_time,
      severity: c.severity ?? "notable", source_char: c.source_char ? resolveId(state, c.source_char) ?? undefined : undefined,
      location_trigger: c.location_trigger, status: "pending",
    });
    shifts.push(fire_time ? `Something is set for ${fire_time.replace(/\s*\(.*\)$/, "")}.` : `Something was set in motion. It will come back around.`);
  }

  for (const ca of diff.clocks_advance ?? []) {
    if ((state.model_settings.tension ?? 5) <= 0) break;   // tension 0: faction clocks freeze, no background escalation
    const clock = state.world.clocks.find((c) => c.id === ca.id || c.faction.toLowerCase() === String(ca.id).toLowerCase());
    if (clock && clock.status === "running") {
      clock.filled = clamp(clock.filled + (ca.segments ?? 1), 0, clock.segments);
      shifts.push(clock.filled >= clock.segments ? `${clock.faction}'s clock has run out.` : `${clock.faction} moved closer to their objective.`);
    }
  }

  return shifts;
}
