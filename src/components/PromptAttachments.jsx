import React, { useRef, useState } from "react";
import { FileText, Image, Loader2, Paperclip, X } from "lucide-react";
import { getFile, listFiles } from "../engine/projectstore.js";
import { attachmentLabel, MAX_PROMPT_ATTACHMENTS, promptAttachmentFromFile, promptAttachmentFromProjectFile } from "../engine/promptAttachments.js";

export default function PromptAttachments({ attachments, onChange, projectId, disabled = false }) {
  const inputRef = useRef(null);
  const [projectPath, setProjectPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const projectFiles = projectId ? listFiles(projectId) : [];
  const add = (next) => onChange([...(attachments || []), next].slice(0, MAX_PROMPT_ATTACHMENTS));
  const upload = async (event) => {
    const files = Array.from(event.target.files || []).slice(0, Math.max(0, MAX_PROMPT_ATTACHMENTS - attachments.length));
    setBusy(true); setError("");
    const next = [];
    for (const file of files) {
      try { next.push(await promptAttachmentFromFile(file)); } catch (cause) { setError(String(cause.message || cause)); }
    }
    if (next.length) onChange([...attachments, ...next].slice(0, MAX_PROMPT_ATTACHMENTS));
    setBusy(false);
    event.target.value = "";
  };
  const attachProjectFile = () => {
    if (!projectPath || !projectId || attachments.length >= MAX_PROMPT_ATTACHMENTS) return;
    try { add(promptAttachmentFromProjectFile(getFile(projectId, projectPath))); setProjectPath(""); setError(""); } catch (cause) { setError(String(cause.message || cause)); }
  };
  return (
    <div className="space-y-1.5">
      {attachments.length > 0 && <div className="flex flex-wrap gap-1.5" aria-label="Prompt attachments">
        {attachments.map((item) => <div key={item.id} className="flex max-w-[220px] items-center gap-1.5 rounded-md border px-2 py-1 text-[10px]" style={{ borderColor: "var(--color-border-subtle)", background: "color-mix(in srgb, var(--color-bg-elevated) 86%, transparent)" }}>
          {item.kind === "image" && item.dataUrl ? <img src={item.dataUrl} alt="" className="h-5 w-5 shrink-0 rounded object-cover" /> : item.kind === "image" ? <Image className="h-3 w-3 shrink-0" /> : <FileText className="h-3 w-3 shrink-0" />}
          <span className="truncate" title={attachmentLabel(item)}>{attachmentLabel(item)}</span>
          <button type="button" onClick={() => onChange(attachments.filter((entry) => entry.id !== item.id))} aria-label={`Remove ${attachmentLabel(item)}`}><X className="h-3 w-3" /></button>
        </div>)}
      </div>}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button type="button" onClick={() => inputRef.current?.click()} disabled={disabled || busy || attachments.length >= MAX_PROMPT_ATTACHMENTS} className="flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] disabled:opacity-40" style={{ borderColor: "var(--color-border-subtle)", color: "var(--color-brand-primary)" }}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />} Attach
        </button>
        <input ref={inputRef} type="file" multiple accept="image/*,.pdf,.docx,text/*,.md,.csv,.tsv,.json,.jsonl,.yaml,.yml,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.r,.sql,.sh,.java,.go,.rs,.c,.cpp,.h,.swift,.toml,.ini,.log,.tex,.bib" onChange={upload} className="hidden" aria-label="Attach local files to prompt" />
        {projectFiles.length > 0 && <><select value={projectPath} onChange={(event) => setProjectPath(event.target.value)} aria-label="Select project file to attach" disabled={disabled || attachments.length >= MAX_PROMPT_ATTACHMENTS} className="max-w-[220px] rounded-md border bg-transparent px-2 py-1 text-[10px]" style={{ borderColor: "var(--color-border-subtle)" }}><option value="">Project file…</option>{projectFiles.map((file) => <option key={file.path} value={file.path}>{file.path}</option>)}</select><button type="button" onClick={attachProjectFile} disabled={!projectPath || disabled} className="rounded-md border px-2 py-1 text-[10px] disabled:opacity-40" style={{ borderColor: "var(--color-border-subtle)" }}>Add</button></>}
        <span className="text-[9px] text-zinc-400">{attachments.length}/{MAX_PROMPT_ATTACHMENTS} · images, native PDF/Word, multilingual text, code and data</span>
      </div>
      {error && <div role="alert" className="text-[10px] text-rose-500">{error}</div>}
    </div>
  );
}
