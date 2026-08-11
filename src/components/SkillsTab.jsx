import React, { useState, useMemo } from "react";
import MarkdownIt from "markdown-it";
import { Wand2, Search, Plus, Save, Edit3, Trash2, Loader2, Eye, Sparkles } from "lucide-react";
import { allSkills, getSkillBody, authorSkill, deleteAuthored, isAuthored, aiOptimizeSkill, SKILL_COUNT } from "../engine/skills.js";
import { activeProvider } from "../engine/providers.js";

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

// Skills engine — read (rendered markdown), author, and AI-optimise skills.
export default function SkillsTab() {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(null);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const provider = activeProvider();

  const skills = useMemo(() => allSkills().filter((s) => !q || s.name.toLowerCase().includes(q.toLowerCase()) || (s.description || "").toLowerCase().includes(q.toLowerCase())), [q, tick]);
  const open = (name) => { setSel(name); setBody(getSkillBody(name)); setEditing(false); };
  const save = () => { authorSkill(sel, body); setEditing(false); setTick((t) => t + 1); };
  const optimize = async () => { setBusy(true); const r = await aiOptimizeSkill(sel, body); setBusy(false); if (r.ok) { setBody(r.body); setEditing(true); } };
  const newSkill = () => { const name = "new-skill-" + (Date.now() % 10000); authorSkill(name, getSkillBody(name)); setTick((t) => t + 1); open(name); setEditing(true); };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Wand2 className="h-6 w-6 text-fuchsia-500" /> Skills Engine</h1>
        </div>
        <button onClick={newSkill} className="flex items-center gap-2 bg-fuchsia-600 hover:bg-fuchsia-700 text-white text-sm font-medium px-4 py-2 rounded-lg"><Plus className="h-4 w-4" /> New skill</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* list */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 text-zinc-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`search ${SKILL_COUNT} skills…`} aria-label="Search skills" className="flex-1 text-xs bg-transparent outline-none" />
          </div>
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] max-h-[64vh] overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
            {skills.slice(0, 200).map((s) => (
              <button key={s.name} onClick={() => open(s.name)} className={`w-full text-left px-3 py-2 ${sel === s.name ? "bg-fuchsia-500/10" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"}`}>
                <div className="text-xs font-medium text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">{s.name}{s.authored && <span className="text-[8px] font-mono text-fuchsia-500">authored</span>}</div>
                <div className="text-[10px] text-zinc-400 line-clamp-1">{s.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* view / edit */}
        <div className="lg:col-span-2">
          {sel ? (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-4">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="text-sm font-semibold flex-1">{sel}</span>
                <button onClick={() => setEditing(!editing)} className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800">{editing ? <Eye className="h-3.5 w-3.5" /> : <Edit3 className="h-3.5 w-3.5" />} {editing ? "Preview" : "Edit"}</button>
                <button onClick={optimize} disabled={busy || !provider} title={provider ? "" : "enable a provider"} className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-md border border-fuchsia-500/40 text-fuchsia-500 hover:bg-fuchsia-500/10 disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} AI optimise</button>
                <button onClick={save} className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-md bg-fuchsia-600 hover:bg-fuchsia-700 text-white"><Save className="h-3.5 w-3.5" /> Save</button>
                {isAuthored(sel) && <button onClick={() => { deleteAuthored(sel); setSel(null); setTick((t) => t + 1); }} className="text-rose-500 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>}
              </div>
              {editing ? (
                <textarea value={body} onChange={(e) => setBody(e.target.value)} className="w-full h-[56vh] text-xs font-mono px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-fuchsia-500 resize-none" />
              ) : (
                <div className="prose-sm max-w-none text-sm text-zinc-700 dark:text-zinc-300 skill-md max-h-[56vh] overflow-y-auto" dangerouslySetInnerHTML={{ __html: md.render(body) }} />
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-10 text-center text-sm text-zinc-500">Select a skill to read, edit, or optimise.</div>
          )}
        </div>
      </div>
    </div>
  );
}
