/** The engine, in your browser. Mirrors the old server API exactly so the views
 *  are unchanged: every method returns the same shapes; streamTurn runs the turn
 *  loop locally with callbacks instead of Server-Sent Events. */
import type {
  SaveState, ModelSettings, WorldBible, WorldState, Identity, AcquiredTrait,
  Condition, CharMemory, TurnHistoryEntry, TurnTelemetry,
} from "../engine/types";
import { newSave, registerCharacter, rollback as doRollback, sanitize, uid } from "../engine/state";
import { buildPreset, PRESET_LIST } from "../engine/presets";
import { runTurn, syncPresence, resolvePlace } from "../engine/turn";
import { runInterlude, embodyCharacter } from "../engine/continuity";
import { seedDrive } from "../engine/drives";
import { FORGE_SYSTEM, OPENING_SYSTEM, NEWSEASON_SYSTEM, buildPortraitPrompt, buildScenePrompt, stablePrefix, volatileDigest } from "../engine/prompts";
import { formatTime, parseTime } from "../engine/time";
import { buildMessages, complete, generateImage, safeJson } from "../llm";
import { getSave, putSave, deleteSave as dbDelete, listSaves as dbList } from "../store";

export type ClientSave = Omit<SaveState, "snapshots"> & { snapshot_turns: number[] };
export type {
  ModelSettings, WorldBible, WorldState, Identity, AcquiredTrait,
  Condition, CharMemory, TurnHistoryEntry, TurnTelemetry,
};
export type ActionMode = "do" | "say" | "story";

export interface PresetInfo { id: string; name: string; blurb: string; era_theme: string }
export interface SaveListing { id: string; name: string; updated_at: string; turn: number; world_name: string }

const clampNum = (v: any, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number(v) || 0));

function clientView(s: SaveState): ClientSave {
  const { snapshots, ...rest } = s;
  return { ...rest, snapshot_turns: snapshots.map((x) => x.turn) };
}
async function need(id: string): Promise<SaveState> {
  const s = await getSave(id);
  if (!s) throw new Error("save not found");
  return s;
}

export const api = {
  presets: async (): Promise<PresetInfo[]> => PRESET_LIST,
  saves: (): Promise<SaveListing[]> => dbList(),
  save: async (id: string): Promise<ClientSave> => clientView(await need(id)),

  newFromPreset: async (presetId: string): Promise<ClientSave> => {
    const s = buildPreset(presetId);
    if (!s) throw new Error("unknown preset");
    await putSave(s);
    return clientView(s);
  },

  remove: async (id: string) => { await dbDelete(id); return { ok: true }; },

  /** Generate (or regenerate) the opening scene prose — the moment before turn 1. Stored as a kind:"opening" history entry. */
  generateOpening: async (id: string): Promise<ClientSave> => {
    const s = await need(id);
    const hint = (s.world.places[s.world.player_location]?.name ?? "") + ". " +
      Object.values(s.characters).filter((c) => c.character_id !== "char_player" && s.world.present.includes(c.character_id)).map((c) => c.name).join(", ");
    const msgs = buildMessages(OPENING_SYSTEM, stablePrefix(s), volatileDigest(s, "opening scene where the player arrives") + `\n\nWrite the opening scene now. Present: ${hint || "as the state dictates"}.`, s.model_settings.narrator_model);
    const out = await complete(msgs, s.model_settings.narrator_model, s.model_settings.fallback_model, false, 1200);
    const entry: TurnHistoryEntry = {
      turn: 0, kind: "opening", player_action: "", narrator_prose: out.text.trim(),
      summary: "The opening.", offscreen: [], time_label: s.world.current_time, weather: s.world.weather,
    };
    s.history = [entry, ...s.history.filter((h) => h.kind !== "opening")];
    await putSave(s);
    return clientView(s);
  },

  /** Save a hand-edited opening scene. */
  setOpening: async (id: string, prose: string): Promise<ClientSave> => {
    const s = await need(id);
    const rest = s.history.filter((h) => h.kind !== "opening");
    if (prose.trim()) {
      const entry: TurnHistoryEntry = {
        turn: 0, kind: "opening", player_action: "", narrator_prose: prose.trim(),
        summary: "The opening.", offscreen: [], time_label: s.world.current_time, weather: s.world.weather,
      };
      s.history = [entry, ...rest];
    } else {
      s.history = rest;
    }
    await putSave(s);
    return clientView(s);
  },

  /** Fork a long save into a NEW chapter: distill current world-state to a fresh start,
   *  carry forward evolved cast + relationships as background, open with a RECAP after a time skip. */
  forkNewSeason: async (id: string): Promise<ClientSave> => {
    const s = await need(id);
    // build a compact digest of the story so far for the model
    const cast = Object.entries(s.characters).filter(([cid, c]) => cid !== "char_player" && c.status !== "dead" && c.status !== "departed").map(([cid, c]) => {
      const edge = s.world.edges.find((e) => e.from === cid && e.to === "char_player");
      const traits = [...(c.core_traits ?? []), ...((s.traits[cid] ?? []).map((t) => t.label))];
      return `${c.name} (${traits.slice(0, 6).join(", ")})${edge ? ` — toward you: warmth ${edge.warmth}, trust ${edge.trust}` : ""}; ${c.drive?.goal ? `wants: ${c.drive.goal}` : ""}`;
    }).join("\n");
    const recentBeats = s.history.filter((h) => h.kind !== "opening").slice(-12).map((h) => h.summary).filter(Boolean).join(" → ");
    const player = s.characters["char_player"];
    const digest = [
      `WORLD: ${s.world_bible.name} — ${s.world_bible.era}. ${s.world_bible.political_situation}`,
      s.world_bible.narrator_direction ? `PLAYER'S STANDING DIRECTION (honor it): ${s.world_bible.narrator_direction}` : "",
      `PLAYER: ${player?.name}. ${player?.background ?? ""}`,
      `CAST:\n${cast}`,
      `CANON: ${(s.world.canon ?? []).join(" | ")}`,
      `OPEN THREADS: ${s.world.threads.map((t) => t.title).join("; ")}`,
      `RECENT EVENTS: ${recentBeats}`,
      `Turns played: ${s.world.current_turn}.`,
    ].filter(Boolean).join("\n\n");

    const msgs = buildMessages(NEWSEASON_SYSTEM, "A finished playthrough to carry into a new chapter:", digest, s.model_settings.forge_model);
    const out = await complete(msgs, s.model_settings.forge_model, s.model_settings.fallback_model, true, 4000);
    const g = safeJson<any>(out.text, null);
    if (!g?.recap || !g?.opening_scene) throw new Error("Couldn't distill a new chapter — try again, or use a stronger forge model.");

    // build the fresh save from the distilled bible (keep most of the original bible, overlay the updates)
    const bible: WorldBible = {
      ...s.world_bible,
      ...(g.world_bible ?? {}),
      name: g.world_bible?.name || `${s.world_bible.name} — Next Chapter`,
    };
    const ns = newSave(bible.name, bible);
    // player carries forward, with their journey folded in
    registerCharacter(ns, {
      ...player, character_id: "char_player",
      background: `${player?.background ?? ""} ${g.player?.background_addition ?? ""}`.trim(),
      drive: undefined, drive_queue: [],
    });
    ns.memory["char_player"].core = s.memory["char_player"].core.slice(-3);

    // place
    const lid = uid("loc");
    ns.world.places[lid] = { id: lid, name: g.starting_location_name || "a new place", description_facts: "", contains: [] };
    ns.world.player_location = lid;
    ns.characters["char_player"].location = lid;

    // surviving cast, with evolved background + relationships baked in
    for (const c of (g.cast ?? [])) {
      if (c.still_present === false || !c.name) continue;
      const prev = Object.values(s.characters).find((x) => x.name.toLowerCase() === c.name.toLowerCase());
      const cid = registerCharacter(ns, {
        name: c.name,
        age: prev?.age ?? 30,
        appearance_facts: prev?.appearance_facts ?? "",
        background: `${prev?.background ?? ""} ${c.background_addition ?? ""}`.trim(),
        core_traits: prev?.core_traits ?? [],
        values: prev?.values ?? [],
        speech_pattern: prev?.speech_pattern ?? "plain",
        texture: prev?.texture ?? [],
        portrait_url: prev?.portrait_url,
        tracked: true,
        location: lid,
        drive: c.new_drive ? { goal: c.new_drive, progress: 0, priority: 1, updated_turn: 1 } : undefined,
      });
      ns.world.edges.push({ from: cid, to: "char_player", warmth: clampNum(c.warmth_to_player, -100, 100), trust: clampNum(c.trust_to_player, -100, 100), power: 0, notes: "carried from the last chapter", updated_turn: 1 });
      ns.memory[cid].core = [`${c.background_addition ?? ""}`].filter(Boolean);
    }
    // carry canon forward (the world-altering facts still happened)
    ns.world.canon = [...(s.world.canon ?? [])].slice(-12);
    // new threads
    for (const t of (g.threads ?? [])) {
      if (!t.title) continue;
      ns.world.threads.push({ id: uid("thr"), title: t.title, status: "active", description: t.description ?? "", turn_started: 1, tension: clampNum(t.tension ?? 3, 1, 10) });
    }
    // time + opening
    ns.world.weather = "";
    syncPresence(ns);
    const recapText = `RECAP: ${g.recap}${g.time_skip ? `\n\n${g.time_skip}.` : ""}\n\n${g.opening_scene}`;
    ns.history = [{ turn: 0, kind: "opening", player_action: "", narrator_prose: recapText, summary: "A new chapter begins.", offscreen: [], time_label: ns.world.current_time, weather: "" }];

    await putSave(ns);
    return clientView(ns);
  },

  /** Set or clear the focus event — the "converge toward this, stop the chaos" toggle. */
  setFocus: async (id: string, label: string | null, opts?: { mode?: "build" | "active"; next_label?: string; auto_link?: boolean }): Promise<ClientSave> => {
    const s = await need(id);
    if (!label || !label.trim()) {
      s.world.focus = null;
    } else {
      const mode = opts?.mode ?? "build";
      let linked_consequence_id: string | undefined;
      if (opts?.auto_link !== false && mode === "build") {
        const pending = s.world.consequences.filter((c) => c.status === "pending");
        pending.sort((a, b) => (a.fire_time && b.fire_time ? (a.fire_time < b.fire_time ? -1 : 1) : a.fire_turn - b.fire_turn));
        linked_consequence_id = pending[0]?.id;
      }
      s.world.focus = {
        label: label.trim(), mode, linked_consequence_id,
        next_label: opts?.next_label?.trim() || (linked_consequence_id ? label.trim() : undefined),
        next_mode: "active",
      };
    }
    await putSave(s);
    return clientView(s);
  },

  /** Set the in-world clock by hand (the bookkeeper sometimes drifts from the prose). Accepts "Day N, HH:MM" or any parseable time. */
  setTime: async (id: string, time: string): Promise<ClientSave> => {
    const s = await need(id);
    if (time?.trim()) s.world.current_time = formatTime(parseTime(time));
    await putSave(s);
    return clientView(s);
  },

  rollback: async (id: string, to_turn: number): Promise<ClientSave> => {
    const s = await need(id);
    const restored = doRollback(s, to_turn);
    if (!restored) throw new Error("no snapshot covers that turn");
    await putSave(restored);
    return clientView(restored);
  },

  settings: async (id: string, patch: Partial<ModelSettings> & { era_theme?: string }): Promise<ClientSave> => {
    const s = await need(id);
    const { era_theme, ...flat } = patch as any;
    s.model_settings = { ...s.model_settings, ...flat };
    if (era_theme) s.world_bible.era_theme = String(era_theme);
    await putSave(s);
    return clientView(s);
  },

  edit: async (id: string, patch: { world_bible?: Partial<WorldBible>; characters?: Record<string, Partial<Identity>>; memory_core?: Record<string, string[]>; canon?: string[] }): Promise<ClientSave> => {
    const s = await need(id);
    if (patch.world_bible) s.world_bible = { ...s.world_bible, ...patch.world_bible };
    for (const [cid, p] of Object.entries(patch.characters ?? {})) {
      if (!s.characters[cid]) continue;
      s.characters[cid] = { ...s.characters[cid], ...p, character_id: cid };
    }
    if (Array.isArray(patch.canon)) s.world.canon = patch.canon.map(String).filter(Boolean).slice(0, 20);
    for (const [cid, core] of Object.entries(patch.memory_core ?? {})) {
      if (s.memory[cid] && Array.isArray(core)) s.memory[cid].core = core.filter(Boolean).slice(0, 8);
    }
    await putSave(s);
    return clientView(s);
  },

  advance: async (id: string, days: number): Promise<ClientSave> => {
    const s = await need(id);
    await runInterlude(s, Math.max(1, Math.min(30, days)), { onPhase: () => {} });
    await putSave(s);
    return clientView(s);
  },

  /** Full raw edit of one character: identity, condition, acquired traits, memory.
   *  Accepts the same shape getCharacterRaw returns. Validates types; missing keys are left as-is. */
  rawEditCharacter: async (id: string, char_id: string, raw: any): Promise<ClientSave> => {
    const s = await need(id);
    if (!s.characters[char_id]) throw new Error("unknown character");
    if (raw && typeof raw === "object") {
      if (raw.identity && typeof raw.identity === "object") {
        s.characters[char_id] = { ...s.characters[char_id], ...raw.identity, character_id: char_id };
      }
      if (raw.condition && typeof raw.condition === "object") {
        s.condition[char_id] = { ...s.condition[char_id], ...raw.condition };
        s.condition[char_id].psyche = { ...s.condition[char_id].psyche, ...(raw.condition.psyche ?? {}) };
      }
      if (Array.isArray(raw.traits)) s.traits[char_id] = raw.traits;
      if (raw.memory && typeof raw.memory === "object") {
        const m = s.memory[char_id];
        if (Array.isArray(raw.memory.core)) m.core = raw.memory.core.filter(Boolean);
        if (Array.isArray(raw.memory.beliefs)) m.beliefs = raw.memory.beliefs;
        if (Array.isArray(raw.memory.episodic)) m.episodic = raw.memory.episodic;
        if (Array.isArray(raw.memory.knows)) m.knows = raw.memory.knows;
      }
    }
    await putSave(s);
    return clientView(s);
  },

  /** The editable slice of one character, for the raw editor. */
  getCharacterRaw: async (id: string, char_id: string): Promise<any> => {
    const s = await need(id);
    return {
      identity: s.characters[char_id],
      condition: s.condition[char_id],
      traits: s.traits[char_id] ?? [],
      memory: s.memory[char_id],
    };
  },

  /** The editable world slice for the raw world editor (no per-character data — use the character editor for that). */
  getWorldRaw: async (id: string): Promise<any> => {
    const s = await need(id);
    return {
      world_bible: s.world_bible,
      threads: s.world.threads,
      clocks: s.world.clocks,
      norms: s.world.norms,
      canon: s.world.canon,
      edges: s.world.edges,
      places: s.world.places,
      weather: s.world.weather,
      current_time: s.world.current_time,
      player_location: s.world.player_location,
      money: s.world.money,
    };
  },

  /** Full raw edit of the world. Validates types; missing keys are left untouched. Re-derives presence. */
  rawEditWorld: async (id: string, raw: any): Promise<ClientSave> => {
    const s = await need(id);
    if (raw && typeof raw === "object") {
      if (raw.world_bible && typeof raw.world_bible === "object") s.world_bible = { ...s.world_bible, ...raw.world_bible };
      if (Array.isArray(raw.threads)) s.world.threads = raw.threads;
      if (Array.isArray(raw.clocks)) s.world.clocks = raw.clocks;
      if (Array.isArray(raw.norms)) s.world.norms = raw.norms;
      if (Array.isArray(raw.canon)) s.world.canon = raw.canon.map(String).filter(Boolean).slice(0, 20);
      if (Array.isArray(raw.edges)) s.world.edges = raw.edges;
      if (raw.places && typeof raw.places === "object") s.world.places = raw.places;
      if (typeof raw.weather === "string") s.world.weather = raw.weather;
      if (typeof raw.current_time === "string" && raw.current_time.trim()) s.world.current_time = formatTime(parseTime(raw.current_time));
      if (typeof raw.money === "string") s.world.money = raw.money;
      if (typeof raw.player_location === "string") {
        s.world.player_location = raw.player_location;
        if (s.characters["char_player"]) s.characters["char_player"].location = raw.player_location;
      }
      // re-derive room occupancy + scene from locations after any places/location change
      for (const p of Object.values(s.world.places)) p.contains = [];
      for (const [cid, c] of Object.entries(s.characters)) {
        if (c.location && s.world.places[c.location]) s.world.places[c.location].contains.push(cid);
      }
      s.world.present = Object.entries(s.characters)
        .filter(([cid, c]) => cid !== "char_player" && c.location === s.world.player_location)
        .map(([cid]) => cid);
    }
    await putSave(s);
    return clientView(s);
  },

  setTracked: async (id: string, char_id: string, tracked: boolean): Promise<ClientSave> => {
    const s = await need(id);
    const c = s.characters[char_id];
    if (!c) throw new Error("unknown character");
    c.tracked = tracked;
    if (tracked && (!c.drive || c.drive.progress >= 100) && !s.world.present.includes(char_id)) {
      const seeded = seedDrive(s, char_id);            // following someone idle gives them a want now
      if (seeded) c.drive = seeded;
    }
    if (!tracked) c.drive = undefined;                 // unfollowed: recede into the background
    await putSave(s);
    return clientView(s);
  },

  embody: async (id: string, char_id: string): Promise<ClientSave> => {
    const s = await need(id);
    const r = embodyCharacter(s, char_id);
    if (!r.ok) throw new Error(r.error);
    await putSave(s);
    return clientView(s);
  },

  portrait: async (id: string, char_id: string): Promise<{ url: string; save: ClientSave }> => {
    const s = await need(id);
    const c = s.characters[char_id];
    if (!c) throw new Error("unknown character");
    c.portrait_url = await generateImage(buildPortraitPrompt(s, char_id), s.model_settings.image_model);
    await putSave(s);
    return { url: c.portrait_url, save: clientView(s) };
  },

  illustrate: async (id: string, turn: number): Promise<{ url: string; save: ClientSave }> => {
    const s = await need(id);
    const entry = [...s.history].reverse().find((h) => h.turn === turn) ?? s.history[s.history.length - 1];
    if (!entry) throw new Error("no turn to illustrate");
    // feed the portraits of characters in this scene so they stay visually consistent
    const refs = ["char_player", ...s.world.present]
      .map((cid) => s.characters[cid]?.portrait_url)
      .filter((u): u is string => !!u && u.startsWith("data:"));
    entry.illustration_url = await generateImage(buildScenePrompt(s, entry.summary), s.model_settings.image_model, refs);
    await putSave(s);
    return { url: entry.illustration_url, save: clientView(s) };
  },

  forge: async (seed: string, model = "deepseek/deepseek-chat-v3-0324"): Promise<ClientSave> => {
    const msgs = buildMessages(FORGE_SYSTEM, "SEED IDEA:", seed, model);
    let g: any = null, lastErr = "";
    for (const m of [model, model, "google/gemini-2.0-flash-001"]) {
      try {
        const out = await complete(msgs, m, m, true, 8000);
        g = safeJson<any>(out.text, null);
        if (g?.world_bible?.name && g?.player?.name && (g.npcs?.length ?? 0) >= 1) break;
        lastErr = `model ${m} returned an incomplete world`;
        g = null;
      } catch (e: any) { lastErr = `${m}: ${e.message}`; g = null; }
    }
    if (!g) throw new Error(`The forge failed after 3 attempts — ${lastErr}. Try a more concrete seed (place + people + problem) or a stronger forge model.`);

    const bible: WorldBible = {
      ...g.world_bible,
      difficulty_profile: g.world_bible.difficulty_profile ?? { lethality: "medium", friction_density: "balanced", antagonist_aggression: "slow_burn", protagonist_competence: "average" },
    };
    const s = newSave(g.world_bible.name || seed.slice(0, 40), bible);
    registerCharacter(s, { ...g.player, character_id: "char_player" });
    s.memory["char_player"].core = [g.player.background].filter(Boolean);

    const nameToId: Record<string, string> = {};
    for (const p of g.places ?? []) {
      const lid = uid("loc");
      s.world.places[lid] = { id: lid, name: p.name, description_facts: p.description_facts ?? "", contains: [] };
      nameToId[p.name?.toLowerCase?.() ?? ""] = lid;
    }
    for (const n of g.npcs ?? []) {
      const cid = registerCharacter(s, { ...n, drive: n.drive_goal ? { goal: n.drive_goal, progress: 10, updated_turn: 1 } : undefined });
      s.memory[cid].core = [n.background].filter(Boolean);
      s.world.edges.push({ from: cid, to: "char_player", warmth: Math.max(-100, Math.min(100, n.warmth ?? 0)), trust: Math.max(-100, Math.min(100, n.trust ?? 0)), power: 0, notes: n.relation_to_player ?? "", updated_turn: 1 });
    }
    for (const c of g.clocks ?? []) {
      s.world.clocks.push({ id: uid("clk"), faction: c.faction ?? "", objective: c.objective ?? "", segments: Math.max(2, c.segments ?? 6), filled: 0, consequence: c.consequence ?? "", visible_signs: c.visible_signs ?? [], status: "running" });
    }
    for (const n of g.norms ?? []) {
      s.world.norms.push({ id: uid("nrm"), rule: n.rule ?? "", enforcement: n.enforcement ?? "gossip", holders: n.holders ?? "" });
    }
    const op = g.opening ?? {};
    s.world.current_time = op.time?.match(/day/i) ? `${op.time}` : "Day 1, 09:00 (Morning)";
    s.world.weather = op.weather ?? "";
    s.world.money = op.money ?? "";
    s.world.player_location = nameToId[(op.player_location_name ?? "").toLowerCase()] ?? Object.keys(s.world.places)[0] ?? "";
    s.characters["char_player"].location = s.world.player_location;
    const openingPresent = (op.present_npc_names ?? [])
      .map((nm: string) => Object.entries(s.characters).find(([cid, c]) => cid !== "char_player" && c.name.toLowerCase() === nm.toLowerCase())?.[0])
      .filter(Boolean) as string[];
    const seatHere = openingPresent.length ? openingPresent : Object.keys(s.characters).filter((cid) => cid !== "char_player").slice(0, 2);
    // everyone starts at the player's location if present, otherwise scattered to their own first place
    const otherPlaces = Object.keys(s.world.places).filter((p) => p !== s.world.player_location);
    let scatter = 0;
    for (const cid of Object.keys(s.characters)) {
      if (cid === "char_player") continue;
      if (seatHere.includes(cid)) s.characters[cid].location = s.world.player_location;
      else s.characters[cid].location = otherPlaces.length ? otherPlaces[scatter++ % otherPlaces.length] : s.world.player_location;
    }
    syncPresence(s);

    await putSave(s);
    return clientView(s);
  },

  /** export returns the full SaveState as a pretty JSON string for download */
  exportSave: async (id: string): Promise<{ name: string; json: string }> => {
    const s = await need(id);
    // snapshots are device-local rollback state (and the biggest payload — full copies × image data).
    // They don't belong in a portable backup; strip them so exports stay small and share/copy reliably.
    const { snapshots, ...portable } = s;
    return { name: s.name.replace(/[^a-z0-9 _-]/gi, ""), json: JSON.stringify(portable, null, 1) };
  },

  importSave: async (data: any): Promise<ClientSave> => {
    if (!data?.world_bible || !data?.world || !data?.characters) throw new Error("not a Weft save file");
    const s = sanitize(data as SaveState);
    s.id = uid("save");
    s.updated_at = new Date().toISOString();
    s.snapshots ??= []; s.telemetry ??= []; s.pressure_trace ??= []; s.history ??= [];
    await putSave(s);
    return clientView(s);
  },
};

export interface TurnEvents {
  onPhase?: (phase: string) => void;
  onDelta?: (text: string) => void;
  onMeta?: (meta: Record<string, unknown>) => void;
  onDone?: (save: ClientSave) => void;
  onError?: (message: string) => void;
}

/** The turn loop, run locally. Same signature the views already use. */
export async function streamTurn(saveId: string, action: string, mode: ActionMode, ev: TurnEvents, opts?: { ground?: boolean }): Promise<void> {
  try {
    const s = await need(saveId);
    await runTurn(s, action, {
      onPhase: (p) => ev.onPhase?.(p),
      onDelta: (t) => ev.onDelta?.(t),
      onMeta: (m) => ev.onMeta?.(m as Record<string, unknown>),
    }, mode, opts);
    await putSave(s);
    ev.onDone?.(clientView(s));
  } catch (e: any) {
    ev.onError?.(e?.message ?? "turn failed");
  }
}
