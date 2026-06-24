import React, { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Moon, Sun, ArrowLeft, BarChart3, Settings2 } from "lucide-react";
import { api, type ClientSave, type InterviewReport } from "./lib/api";
import { hasApiKey, setApiKey, hasModel, setModel } from "./config";
import AssessmentLibrary from "./views/AssessmentLibrary";
import InterviewBuilder from "./views/InterviewBuilder";
import Assessment from "./views/Assessment";
import AssessmentSettings, { ModelPicker } from "./views/AssessmentSettings";
import InterviewReportView from "./views/InterviewReport";
import { applyProseFont } from "./lib/theme";

type Mode = "library" | "build" | "run" | "report" | "settings";

export default function App() {
  const [save, setSave] = useState<ClientSave | null>(null);
  const [report, setReport] = useState<InterviewReport | null>(null);
  const [mode, setMode] = useState<Mode>("library");
  const [lightMode, setLightMode] = useState(() => localStorage.getItem("weft-mode") === "light");
  const [needKey, setNeedKey] = useState(!hasApiKey() || !hasModel());
  const [keyInput, setKeyInput] = useState("");
  const [modelInput, setModelInput] = useState("");
  const [settingsReturn, setSettingsReturn] = useState<Mode>("library");

  useEffect(() => {
    document.documentElement.setAttribute("data-mode", lightMode ? "light" : "dark");
    localStorage.setItem("weft-mode", lightMode ? "light" : "dark");
  }, [lightMode]);

  useEffect(() => { document.documentElement.setAttribute("data-theme", "ember"); }, []);
  useEffect(() => { applyProseFont(localStorage.getItem("weft-prose-font") ?? "newsreader"); }, []);

  const openSave = useCallback(async (id: string) => {
    const s = await api.save(id);
    setSave(s);
    if (s.interview_report) { setReport(s.interview_report); setMode("report"); }
    else { setMode("run"); }
  }, []);

  const backToLibrary = useCallback(() => { setSave(null); setReport(null); setMode("library"); }, []);

  const title =
    mode === "build" ? "New assessment"
    : mode === "run" && save ? (save.world_bible.name)
    : mode === "settings" ? "Settings"
    : mode === "report" ? "Assessment report"
    : "Assessments";

  if (needKey) {
    return (
      <div className="shell">
        <div className="flex-1 flex items-center justify-center px-6 py-8 overflow-y-auto">
          <div className="card p-6 max-w-md w-full">
            <div className="font-display text-[22px] mb-1" style={{ fontVariationSettings: '"SOFT" 60, "WONK" 1' }}>Management Assessment</div>
            <div className="text-[13.5px] mb-4" style={{ color: "var(--text-mid)" }}>
              A management work-sample tool. It runs in your browser through your own OpenRouter key. Paste your key and pick the model that will run everything.
            </div>
            <label className="text-[11px] uppercase tracking-wide mb-1 block" style={{ color: "var(--text-mid)" }}>OpenRouter API key</label>
            <input className="field" style={{ fontFamily: "var(--font-mono)", fontSize: 13 }} type="password"
              placeholder="sk-or-..." value={keyInput} onChange={(e) => { setKeyInput(e.target.value); setApiKey(e.target.value.trim()); }} />
            <div className="mt-4 mb-1">
              <label className="text-[11px] uppercase tracking-wide mb-1 block" style={{ color: "var(--text-mid)" }}>Model (runs everything)</label>
              <ModelPicker value={modelInput} onChange={setModelInput} />
            </div>
            <button className="btn btn-accent w-full mt-4" disabled={!keyInput.trim() || !modelInput.trim()}
              onClick={() => { setApiKey(keyInput.trim()); setModel(modelInput.trim()); setNeedKey(false); }}>
              Begin
            </button>
            <div className="text-[11px] italic mt-3" style={{ color: "var(--text-lo)" }}>
              Stored only in this browser, sent only to OpenRouter. Keys at openrouter.ai/keys. The model list loads once your key is entered.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="topbar z-30">
        <div className="flex items-center justify-between px-4 py-2.5">
          <button className="text-left flex items-center gap-2" onClick={mode !== "library" ? backToLibrary : undefined}>
            {mode !== "library" && <ArrowLeft size={15} style={{ color: "var(--text-mid)" }} />}
            <div>
              <div className="font-display text-[17px] leading-tight" style={{ fontVariationSettings: '"SOFT" 60, "WONK" 1' }}>{title}</div>
              <div className="font-mono text-[10px] tracking-wider uppercase" style={{ color: "var(--text-lo)" }}>
                {mode === "run" ? "in assessment" : "work-sample"}
              </div>
            </div>
          </button>
          <div className="flex items-center gap-2">
            {mode === "run" && save?.interview_report && (
              <button className="chip" onClick={() => { setReport(save.interview_report!); setMode("report"); }}>
                <BarChart3 size={11} /> report
              </button>
            )}
            {(save && (mode === "run" || mode === "report" || mode === "settings")) || mode === "library" || mode === "build" ? (
              <button className="chip" onClick={() => {
                if (mode === "settings") setMode(settingsReturn);
                else { setSettingsReturn(mode); setMode("settings"); }
              }}>
                <Settings2 size={11} /> {mode === "settings" ? "back" : "settings"}
              </button>
            ) : null}
            <button className="chip" onClick={() => setLightMode((v) => !v)} aria-label="theme">
              {lightMode ? <Moon size={11} /> : <Sun size={11} />}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 relative">
        <AnimatePresence mode="wait">
          {mode === "library" && (
            <motion.div key="library" className="absolute inset-0"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.26, ease: [0.2, 0.8, 0.2, 1] }}>
              <AssessmentLibrary onOpen={openSave} onBuild={() => setMode("build")} />
            </motion.div>
          )}
          {mode === "build" && (
            <motion.div key="build" className="absolute inset-0"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.26, ease: [0.2, 0.8, 0.2, 1] }}>
              <InterviewBuilder onCreated={(id) => { openSave(id); }} />
            </motion.div>
          )}
          {mode === "run" && save && (
            <motion.div key="run" className="absolute inset-0"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}>
              <Assessment save={save} setSave={setSave}
                onGraded={(r, s) => { setReport(r); setSave(s); setMode("report"); }} />
            </motion.div>
          )}
          {mode === "settings" && (
            <motion.div key="settings" className="absolute inset-0"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22 }}>
              <AssessmentSettings save={save} setSave={setSave} />
            </motion.div>
          )}
          {mode === "report" && save && report && (
            <motion.div key="report" className="absolute inset-0"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22 }}>
              <InterviewReportView report={report} save={save} onClose={backToLibrary} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
