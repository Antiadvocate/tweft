import React, { useState } from "react";
import { Check, AlertCircle, Loader2 } from "lucide-react";
import { api, type ClientSave } from "../lib/api";
import { getApiKey, setApiKey } from "../config";

/** A small curated list of OpenRouter models that work well for the simulation.
 *  Any slug can be typed in the custom field — this is just for convenience. */
const MODEL_CHOICES: { slug: string; label: string; note: string }[] = [
  { slug: "deepseek/deepseek-v4-pro", label: "DeepSeek V4", note: "cheap, capable — the default" },
  { slug: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash", note: "fast, inexpensive" },
  { slug: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", note: "stronger, still fast" },
  { slug: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet", note: "high quality, pricier" },
  { slug: "openai/gpt-4o-mini", label: "GPT-4o mini", note: "balanced" },
  { slug: "openai/gpt-4o", label: "GPT-4o", note: "high quality, pricier" },
  { slug: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B", note: "open weights" },
];

const field: React.CSSProperties = { background: "var(--surface-1)", border: "1px solid var(--border)" };
const lbl = "text-[11px] uppercase tracking-wide mb-1.5 block";
const lblStyle = { color: "var(--text-mid)" } as React.CSSProperties;

export default function AssessmentSettings({ save, setSave }: {
  save: ClientSave | null;
  setSave: (s: ClientSave) => void;
}) {
  const [keyInput, setKeyInput] = useState(getApiKey());
  const [primary, setPrimary] = useState(save?.model_settings.simulator_model ?? "deepseek/deepseek-v4-pro");
  const [fallback, setFallback] = useState(save?.model_settings.fallback_model ?? "google/gemini-2.0-flash-001");
  const [customPrimary, setCustomPrimary] = useState(
    save && !MODEL_CHOICES.some((m) => m.slug === save.model_settings.simulator_model) ? save.model_settings.simulator_model : ""
  );
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function saveAll() {
    setApiKey(keyInput.trim());
    const sim = customPrimary.trim() || primary;
    // model selection persists onto the active save; the key is global to this browser.
    if (save) {
      const updated = await api.settings(save.id, {
        simulator_model: sim,
        narrator_model: sim,
        forge_model: sim,
        fallback_model: fallback,
      });
      setSave(updated);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  /** Hit OpenRouter directly with the chosen model so the REAL error surfaces
   *  (a bad model → 400 with a message; a bad key → 401; CORS/offline → fetch fail). */
  async function testConnection() {
    setTesting(true); setTestResult(null);
    const k = keyInput.trim();
    if (!k) { setTesting(false); setTestResult({ ok: false, msg: "No API key entered." }); return; }
    const model = customPrimary.trim() || primary;
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${k}`, "HTTP-Referer": location.origin, "X-Title": "Management Assessment" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "reply with the single word: ok" }], max_tokens: 5 }),
      });
      if (!res.ok) {
        const body = await res.text();
        setTestResult({ ok: false, msg: `HTTP ${res.status}: ${body.slice(0, 200)}` });
      } else {
        const data = await res.json();
        const txt = data.choices?.[0]?.message?.content ?? "";
        setTestResult({ ok: true, msg: `Connected. Model replied: "${String(txt).trim().slice(0, 40)}"` });
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
        The app talks to models through your own OpenRouter key. If turns fail with “failed to fetch,” re-check the key and run the connection test below.
      </div>

      {/* API key */}
      <div className="mb-6">
        <label className={lbl} style={lblStyle}>OpenRouter API key</label>
        <input type="password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)}
          placeholder="sk-or-..." className="w-full rounded-lg p-2.5 text-[13px]"
          style={{ ...field, fontFamily: "var(--font-mono)" }} />
        <div className="text-[11px] mt-1.5" style={{ color: "var(--text-lo)" }}>
          Stored only in this browser. Get one at openrouter.ai/keys. Make sure it has credit and the model below is enabled for your account.
        </div>
      </div>

      {/* model */}
      <div className="mb-4">
        <label className={lbl} style={lblStyle}>Model (runs the simulation & grading)</label>
        {!save && (
          <div className="text-[11px] mb-2 rounded-md p-2" style={{ background: "rgba(200,163,90,0.1)", color: "var(--text-mid)" }}>
            Open or build an assessment to change its model. The key and connection test below work now.
          </div>
        )}
        <div className="grid grid-cols-1 gap-1.5">
          {MODEL_CHOICES.map((m) => (
            <button key={m.slug} onClick={() => { setPrimary(m.slug); setCustomPrimary(""); }}
              className="text-left rounded-lg p-2.5 flex items-center justify-between"
              style={{ ...field, borderColor: (!customPrimary && primary === m.slug) ? "var(--accent)" : "var(--border)" }}>
              <div>
                <div className="text-[13px] font-display">{m.label}</div>
                <div className="text-[11px]" style={{ color: "var(--text-mid)" }}>{m.note}</div>
              </div>
              <code className="text-[10px]" style={{ color: "var(--text-lo)" }}>{m.slug}</code>
            </button>
          ))}
        </div>
        <label className="text-[11px] mt-3 mb-1 block" style={lblStyle}>…or any OpenRouter model slug</label>
        <input value={customPrimary} onChange={(e) => setCustomPrimary(e.target.value)}
          placeholder="vendor/model-name" className="w-full rounded-lg p-2.5 text-[13px]"
          style={{ ...field, fontFamily: "var(--font-mono)" }} />
      </div>

      {/* fallback */}
      <div className="mb-5">
        <label className={lbl} style={lblStyle}>Fallback model (used if the primary fails)</label>
        <input value={fallback} onChange={(e) => setFallback(e.target.value)}
          className="w-full rounded-lg p-2.5 text-[13px]" style={{ ...field, fontFamily: "var(--font-mono)" }} />
      </div>

      <div className="flex items-center gap-3 mb-4">
        <button onClick={saveAll} className="px-4 py-2 rounded-lg text-[13px] font-display"
          style={{ background: "var(--accent)", color: "var(--bg)" }}>
          {saved ? "Saved ✓" : "Save"}
        </button>
        <button onClick={testConnection} disabled={testing}
          className="px-4 py-2 rounded-lg text-[13px] flex items-center gap-2" style={field}>
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
