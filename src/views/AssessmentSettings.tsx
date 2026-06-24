import React, { useEffect, useMemo, useState } from "react";
import { Check, AlertCircle, Loader2, Search } from "lucide-react";
import { api, type ClientSave } from "../lib/api";
import { getApiKey, setApiKey, getModel, setModel } from "../config";
import { listModels, type ORModel } from "../llm";

const field: React.CSSProperties = { background: "var(--surface-1)", border: "1px solid var(--border)" };
const lbl = "text-[11px] uppercase tracking-wide mb-1.5 block";
const lblStyle = { color: "var(--text-mid)" } as React.CSSProperties;

function priceLabel(p?: number): string {
  if (p == null) return "";
  if (p === 0) return "free";
  const perM = p * 1_000_000;
  return `$${perM < 1 ? perM.toFixed(2) : perM.toFixed(1)}/M`;
}

/** Live OpenRouter model picker — fetches the same catalog as the website. */
export function ModelPicker({ value, onChange }: { value: string; onChange: (slug: string) => void }) {
  const [models, setModels] = useState<ORModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    listModels().then((m) => { if (!alive) return; setModels(m); setLoading(false); setFailed(m.length === 0); });
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return models;
    return models.filter((m) => m.id.toLowerCase().includes(s) || m.name.toLowerCase().includes(s));
  }, [q, models]);

  return (
    <div>
      <div className="flex items-center gap-2 rounded-lg px-2.5 mb-2" style={field}>
        <Search size={14} style={{ color: "var(--text-lo)" }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={loading ? "loading models…" : `search ${models.length} models…`}
          className="flex-1 bg-transparent py-2 text-[13px] outline-none" style={{ color: "var(--text-hi)" }} />
      </div>

      {failed && (
        <div className="text-[12px] mb-2 rounded-md p-2" style={{ background: "rgba(200,163,90,0.1)", color: "var(--text-mid)" }}>
          Couldn't load the live model list (need a valid key, or network blocked). You can still type a slug below.
        </div>
      )}

      <div className="max-h-64 overflow-y-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
        {loading ? (
          <div className="p-4 text-[13px] flex items-center gap-2" style={{ color: "var(--text-lo)" }}><Loader2 size={14} className="animate-spin" /> loading…</div>
        ) : filtered.length === 0 && !failed ? (
          <div className="p-4 text-[13px]" style={{ color: "var(--text-lo)" }}>No matches.</div>
        ) : (
          filtered.slice(0, 200).map((m) => (
            <button key={m.id} onClick={() => onChange(m.id)}
              className="w-full text-left px-3 py-2 flex items-center justify-between gap-2"
              style={{ background: value === m.id ? "var(--surface-2)" : "transparent", borderLeft: `2px solid ${value === m.id ? "var(--accent)" : "transparent"}` }}>
              <div className="min-w-0">
                <div className="text-[13px] truncate">{m.name}</div>
                <code className="text-[10px]" style={{ color: "var(--text-lo)" }}>{m.id}</code>
              </div>
              <div className="text-[10px] shrink-0 text-right" style={{ color: "var(--text-lo)" }}>
                {m.context ? <div>{Math.round(m.context / 1000)}k ctx</div> : null}
                {priceLabel(m.promptPrice) ? <div>{priceLabel(m.promptPrice)}</div> : null}
              </div>
            </button>
          ))
        )}
      </div>

      <label className="text-[11px] mt-2.5 mb-1 block" style={lblStyle}>…or type any model slug</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="vendor/model-name"
        className="w-full rounded-lg p-2.5 text-[13px]" style={{ ...field, fontFamily: "var(--font-mono)" }} />
    </div>
  );
}

export default function AssessmentSettings({ save, setSave }: {
  save: ClientSave | null;
  setSave: (s: ClientSave) => void;
}) {
  const [keyInput, setKeyInput] = useState(getApiKey());
  const [model, setModelState] = useState(getModel());
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function saveAll() {
    setApiKey(keyInput.trim());
    setModel(model.trim());                 // the global model that drives everything
    // also push it onto the active save's slots so the current assessment uses it immediately
    if (save && model.trim()) {
      const updated = await api.settings(save.id, {
        simulator_model: model.trim(), narrator_model: model.trim(),
        forge_model: model.trim(), fallback_model: model.trim(),
      });
      setSave(updated);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  async function testConnection() {
    setTesting(true); setTestResult(null);
    const k = keyInput.trim();
    if (!k) { setTesting(false); setTestResult({ ok: false, msg: "No API key entered." }); return; }
    if (!model.trim()) { setTesting(false); setTestResult({ ok: false, msg: "No model selected." }); return; }
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${k}`, "HTTP-Referer": location.origin, "X-Title": "Management Assessment" },
        body: JSON.stringify({ model: model.trim(), messages: [{ role: "user", content: "reply with the single word: ok" }], max_tokens: 5 }),
      });
      if (!res.ok) {
        const body = await res.text();
        setTestResult({ ok: false, msg: `HTTP ${res.status}: ${body.slice(0, 200)}` });
      } else {
        const data = await res.json();
        const txt = data.choices?.[0]?.message?.content ?? "";
        setTestResult({ ok: true, msg: `Connected. ${model.trim()} replied: "${String(txt).trim().slice(0, 40)}"` });
      }
    } catch (e: any) {
      setTestResult({ ok: false, msg: `Request blocked before a response: ${e?.message ?? "fetch failed"}. Usually a missing/invalid key or a network/ad-blocker issue.` });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto px-5 sm:px-8 py-6 max-w-xl mx-auto">
      <div className="font-display text-lg mb-1">Settings</div>
      <div className="text-[13px] mb-6" style={{ color: "var(--text-mid)" }}>
        The app talks to models through your own OpenRouter key. The model you pick here runs <em>everything</em> — the simulation, the grading, and scenario generation. There are no hidden defaults.
      </div>

      <div className="mb-6">
        <label className={lbl} style={lblStyle}>OpenRouter API key</label>
        <input type="password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)}
          placeholder="sk-or-..." className="w-full rounded-lg p-2.5 text-[13px]" style={{ ...field, fontFamily: "var(--font-mono)" }} />
        <div className="text-[11px] mt-1.5" style={{ color: "var(--text-lo)" }}>
          Stored only in this browser. Get one at openrouter.ai/keys.
        </div>
      </div>

      <div className="mb-5">
        <label className={lbl} style={lblStyle}>Model — runs everything</label>
        <div className="text-[12px] mb-2" style={{ color: model ? "var(--accent)" : "#c8a35a" }}>
          {model ? `Currently: ${model}` : "No model selected yet — pick one below."}
        </div>
        <ModelPicker value={model} onChange={setModelState} />
      </div>

      <div className="flex items-center gap-3 mb-4">
        <button onClick={saveAll} disabled={!model.trim()} className="px-4 py-2 rounded-lg text-[13px] font-display"
          style={{ background: "var(--accent)", color: "var(--bg)", opacity: model.trim() ? 1 : 0.5 }}>
          {saved ? "Saved ✓" : "Save"}
        </button>
        <button onClick={testConnection} disabled={testing} className="px-4 py-2 rounded-lg text-[13px] flex items-center gap-2" style={field}>
          {testing ? <Loader2 size={14} className="animate-spin" /> : null}
          {testing ? "Testing…" : "Test connection"}
        </button>
      </div>

      {testResult && (
        <div className="rounded-lg p-3 text-[12.5px] flex items-start gap-2"
          style={{ background: testResult.ok ? "rgba(106,166,122,0.1)" : "rgba(192,122,106,0.1)", border: `1px solid ${testResult.ok ? "rgba(106,166,122,0.3)" : "rgba(192,122,106,0.3)"}` }}>
          {testResult.ok ? <Check size={15} style={{ color: "var(--accent)", marginTop: 1 }} /> : <AlertCircle size={15} style={{ color: "#c07a6a", marginTop: 1 }} />}
          <span style={{ color: "var(--text-mid)" }}>{testResult.msg}</span>
        </div>
      )}
    </div>
  );
}
