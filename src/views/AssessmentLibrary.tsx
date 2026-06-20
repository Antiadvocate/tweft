import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Plus, Trash2, CheckCircle2, Circle, FileText } from "lucide-react";
import { api, type SaveListing, type ClientSave } from "../lib/api";

export default function AssessmentLibrary({ onOpen, onBuild }: {
  onOpen: (id: string) => void;
  onBuild: () => void;
}) {
  const [saves, setSaves] = useState<SaveListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [graded, setGraded] = useState<Record<string, boolean>>({});

  async function refresh() {
    setLoading(true);
    const list = await api.saves();
    setSaves(list);
    // probe graded status (cheap: each save's interview_report presence)
    const g: Record<string, boolean> = {};
    for (const l of list) {
      try { const s = await api.save(l.id); g[l.id] = !!(s as ClientSave).interview_report; } catch { g[l.id] = false; }
    }
    setGraded(g);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  async function remove(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this assessment? This can't be undone.")) return;
    await api.remove(id);
    refresh();
  }

  return (
    <div className="h-full overflow-y-auto px-5 sm:px-8 py-8 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <div className="font-display text-[22px]" style={{ fontVariationSettings: '"SOFT" 60, "WONK" 1' }}>Assessments</div>
        <button onClick={onBuild} className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-display"
          style={{ background: "var(--accent)", color: "var(--bg)" }}>
          <Plus size={15} /> New assessment
        </button>
      </div>
      <div className="text-[13px] mb-6" style={{ color: "var(--text-mid)" }}>
        Management work-sample assessments. Build one once and give the link to every candidate — they all face the identical scenario, clock, and rubric.
      </div>

      {loading ? (
        <div className="text-[13px]" style={{ color: "var(--text-lo)" }}>Loading…</div>
      ) : saves.length === 0 ? (
        <div className="rounded-lg p-6 text-center" style={{ background: "var(--surface-1)", border: "1px dashed var(--border)" }}>
          <FileText size={28} className="mx-auto mb-2" style={{ color: "var(--text-lo)" }} />
          <div className="text-[14px] mb-1">No assessments yet</div>
          <div className="text-[13px] mb-4" style={{ color: "var(--text-mid)" }}>Build your first one — define the role, the team, and the scenario.</div>
          <button onClick={onBuild} className="px-4 py-2 rounded-lg text-[13px] font-display" style={{ background: "var(--accent)", color: "var(--bg)" }}>
            Build an assessment
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {saves.map((s) => (
            <motion.button key={s.id} onClick={() => onOpen(s.id)}
              whileHover={{ y: -1 }}
              className="text-left rounded-lg p-4 flex items-center gap-3"
              style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}>
              {graded[s.id] ? <CheckCircle2 size={18} style={{ color: "var(--accent)" }} /> : <Circle size={18} style={{ color: "var(--text-lo)" }} />}
              <div className="flex-1 min-w-0">
                <div className="font-display text-[15px] truncate">{s.world_name || s.name}</div>
                <div className="text-[12px]" style={{ color: "var(--text-mid)" }}>
                  {graded[s.id] ? "graded" : s.turn > 0 ? `in progress · ${s.turn} turns` : "not started"} · {new Date(s.updated_at).toLocaleDateString()}
                </div>
              </div>
              <button onClick={(e) => remove(s.id, e)} className="shrink-0 p-1.5 rounded-md" style={{ color: "var(--text-lo)" }} aria-label="delete">
                <Trash2 size={15} />
              </button>
            </motion.button>
          ))}
        </div>
      )}
    </div>
  );
}
