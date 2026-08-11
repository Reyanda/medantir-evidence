import React, { useState } from "react";
import { ShieldHalf, Loader2, CheckCircle2, Radar, ShieldAlert, Server, Cpu, KeyRound, ShieldCheck, Terminal, AlertTriangle, FileCode, Check, Binary, Search, Eye, EyeOff, Lock, Unlock, Code, ExternalLink, Wand2, FileSearch, Hash, Braces, Copy, Download } from "lucide-react";

// Cyber engine — modules:
//  1. Attack Surface: Sentinel backend (requires project token).
//  2. Threat Model: AI provider (requires configured provider).
//  3. Strix Pentest: Sentinel backend scan engine (requires project token).
//  4. Reverse Engineering: local binary analysis reference (no backend).
//  5. Deobfuscator: local JS deobfuscation (no backend).
//  6. De-Paywall: API key configuration reference.
//  7. Sentinel API: full red-team backend console.

function AttackSurface({ projectId, token }) {
   const [data, setData] = useState(null);
   const [busy, setBusy] = useState(false);
   const pull = async () => {
     if (!projectId || !token) { setData({ ok: false, error: "Select a project and store its Sentinel token first" }); return; }
     setBusy(true); setData(await callModule("redteam", "/surface/attack", { token, projectId })); setBusy(false);
   };
   return (
     <div className="space-y-3">
       <div className="text-xs text-zinc-500">The real attack surface comes from your Sentinel backend — no fabricated inventory.</div>
       <button onClick={pull} disabled={busy} className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg">
         {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />} Pull attack surface
       </button>
       {data && (
         <div className={`rounded-lg border p-3 text-[11px] font-mono ${data.ok ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400" : "border-amber-500/30 text-amber-500"}`}>
           {data.ok ? <pre className="whitespace-pre-wrap text-zinc-600 dark:text-zinc-300">{JSON.stringify(data.data, null, 1).slice(0, 1200)}</pre> : <>Sentinel offline — {(data.error || "").slice(0, 100)}. Configure its URL in the Sentinel tab / Connectors.</>}
         </div>
       )}
     </div>
   );
 }

function ThreatModel() {
   const [target, setTarget] = useState("");
   const [busy, setBusy] = useState(false);
   const [out, setOut] = useState(null);
   const provider = activeProvider();

   const run = async () => {
     setBusy(true);
     const r = await multiModelAsk(
       `Produce a concise defensive threat model for this asset. List: (1) top 4 threats (STRIDE), (2) likely attack paths, (3) prioritised mitigations. Asset: ${target}`,
       { system: "You are a defensive security architect. Output actionable, non-offensive guidance only." }
     );
     setOut(r); setBusy(false);
   };

   return (
     <div className="space-y-3">
       <textarea value={target} onChange={(e) => setTarget(e.target.value)} rows={2} placeholder="Describe the asset or system to threat-model…" className="w-full text-sm px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-rose-500 resize-none" />
       <button onClick={run} disabled={busy || !provider || !target.trim()} className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg">
         {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cpu className="h-4 w-4" />} Generate threat model
       </button>
       {!provider && <div className="text-[11px] font-mono text-amber-500">Enable an AI provider to generate threat models.</div>}
       {out?.ok && out.answers.map((a) => (
         <div key={a.providerId} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
           <div className="text-[10px] font-mono font-bold text-rose-500 mb-1">{a.label}</div>
           <div className="text-xs text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">{a.text || a.error}</div>
         </div>
       ))}
     </div>
   );
 }

const RE_TOOLS = [
  {
    id: "hopper",
    name: "Hopper Disassembly",
    category: "Disassembler",
    description: "Native macOS/Linux disassembler that reveals assembly-level program structure without recovering original source code.",
    reveals: [
      "Assembly-level instruction flow and call graphs",
      "Function boundaries and calling conventions",
      "String literals (URLs, error messages, API endpoints)",
      "Import/export tables and library dependencies",
      "Stack frame layouts and local variable sizes"
    ],
    cannotRecover: [
      "Original variable names (replaced by register/stack offsets)",
      "Developer comments and documentation",
      "High-level control structures (loops, conditionals)",
      "Build configurations and compiler flags"
    ],
    url: "https://www.hopperapp.com",
    icon: "Binary"
  },
  {
    id: "ghidra",
    name: "Ghidra",
    category: "Reverse Engineering Framework",
    description: "NSA-developed suite with decompiler producing pseudocode — readable but not identical to original source.",
    reveals: [
      "Pseudocode reconstruction (decompiled C-like output)",
      "Cross-references and data flow analysis",
      "Function signatures and parameter types",
      "Symbol resolution and library identification",
      "Annotated disassembly with type propagation"
    ],
    cannotRecover: [
      "Exact original variable names (inferred, not recovered)",
      "Developer comments embedded in source",
      "Preprocessor macros and conditional compilation",
      "Build system configurations (Makefiles, CMake, etc.)"
    ],
    url: "https://ghidra-sre.org",
    icon: "Code"
  },
  {
    id: "otool_nm",
    name: "otool / nm",
    category: "Symbol & Dependency Inspector",
    description: "Command-line utilities for inspecting Mach-O/ELF binary structure, symbols, and linked libraries.",
    reveals: [
      "Exported and imported symbol names",
      "Dynamic library dependencies (linked frameworks/so files)",
      "Section boundaries (__TEXT, __DATA, __LINKEDIT)",
      "Objective-C class and method metadata (otool -oV)",
      "Relocation entries and load commands"
    ],
    cannotRecover: [
      "Function implementations (only signatures visible)",
      "Internal logic or algorithm details",
      "String contents without additional extraction",
      "Compiler optimization artifacts"
    ],
    url: "https://llvm.org/docs/CommandGuide/llvm-nm.html",
    icon: "Search"
  }
];

const TOOL_REVEALS_BG = "border-emerald-500/20 text-emerald-600 dark:text-emerald-400";
const TOOL_CANT_BG = "border-rose-500/20 text-rose-600 dark:text-rose-400";

function BinaryAnalysis() {
  const [selectedTool, setSelectedTool] = useState(RE_TOOLS[0]);
  const [analysisTarget, setAnalysisTarget] = useState("");
  const [analysisNotes, setAnalysisNotes] = useState("");

  const toolIconMap = { Binary, Code, Search };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Binary className="h-5 w-5 text-rose-500" />
          <h3 className="text-sm font-bold">Reverse Engineering & Binary Analysis</h3>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
          Native binaries <span className="font-semibold text-zinc-700 dark:text-zinc-300">cannot be trivially decompiled</span> to recover original source code.
          These tools expose structural artefacts — symbols, call patterns, dependencies — but the developer's original variable names,
          comments, full source structure, and build configurations remain unrecoverable from the binary alone.
        </p>
      </div>

      {/* Tool selector */}
      <div className="flex gap-2 flex-wrap">
        {RE_TOOLS.map((tool) => {
          const Icon = toolIconMap[tool.icon] || Binary;
          return (
            <button
              key={tool.id}
              onClick={() => setSelectedTool(tool)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                selectedTool.id === tool.id
                  ? "border-rose-500 bg-rose-500/10 text-rose-500"
                  : "border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tool.name}
            </button>
          );
        })}
      </div>

      {/* Selected tool detail */}
      {selectedTool && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* What it reveals */}
          <div className="rounded-lg border border-emerald-500/20 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase text-emerald-500">
              <Eye className="h-3.5 w-3.5" /> What {selectedTool.name} reveals
            </div>
            <div className="text-[10px] font-mono text-zinc-400 mb-1">{selectedTool.category}</div>
            <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">{selectedTool.description}</p>
            <ul className="space-y-1 mt-2">
              {selectedTool.reveals.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-[11px] font-mono">
                  <Check className="h-3 w-3 text-emerald-500 mt-0.5 shrink-0" />
                  <span className="text-zinc-600 dark:text-zinc-300">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* What it cannot recover */}
          <div className="rounded-lg border border-rose-500/20 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase text-rose-500">
              <EyeOff className="h-3.5 w-3.5" /> What cannot be recovered
            </div>
            <div className="text-[10px] font-mono text-zinc-400 mb-1">Fundamental limitation of binary analysis</div>
            <ul className="space-y-1 mt-2">
              {selectedTool.cannotRecover.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-[11px] font-mono">
                  <Lock className="h-3 w-3 text-rose-500 mt-0.5 shrink-0" />
                  <span className="text-zinc-600 dark:text-zinc-300">{item}</span>
                </li>
              ))}
            </ul>
            <a
              href={selectedTool.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] font-mono text-rose-500 hover:underline mt-2"
            >
              <ExternalLink className="h-3 w-3" /> Official documentation
            </a>
          </div>
        </div>
      )}

      {/* Quick reference comparison */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 space-y-2">
        <div className="text-[10px] font-mono font-bold uppercase text-zinc-400">Quick Reference — Binary Analysis Capabilities</div>
        <div className="overflow-x-auto">
          <table className="w-full text-[10px] font-mono">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="text-left py-1.5 pr-3 text-zinc-400 font-medium">Capability</th>
                <th className="text-center py-1.5 px-2 text-rose-500 font-medium">Hopper</th>
                <th className="text-center py-1.5 px-2 text-rose-500 font-medium">Ghidra</th>
                <th className="text-center py-1.5 px-2 text-rose-500 font-medium">otool / nm</th>
              </tr>
            </thead>
            <tbody className="text-zinc-600 dark:text-zinc-300">
              {[
                ["Function names / signatures", "✓", "✓", "✓"],
                ["Assembly listing", "✓", "✓", "partial"],
                ["Pseudocode (decompiled)", "✓", "✓", "—"],
                ["String literals extraction", "✓", "✓", "partial"],
                ["Library dependencies", "✓", "✓", "✓"],
                ["Call graph / xrefs", "✓", "✓", "—"],
                ["Type propagation", "—", "✓", "—"],
                ["Mach-O / ELF structure", "—", "✓", "✓"],
                ["Original variable names", "✗", "✗", "✗"],
                ["Developer comments", "✗", "✗", "✗"],
                ["Build configuration", "✗", "✗", "✗"]
              ].map(([cap, h, g, o], i) => (
                <tr key={i} className="border-b border-zinc-100 dark:border-zinc-800/50">
                  <td className="py-1.5 pr-3">{cap}</td>
                  <td className="text-center py-1.5 px-2">{h === "✓" ? <span className="text-emerald-500">✓</span> : h === "✗" ? <span className="text-rose-500">✗</span> : h}</td>
                  <td className="text-center py-1.5 px-2">{g === "✓" ? <span className="text-emerald-500">✓</span> : g === "✗" ? <span className="text-rose-500">✗</span> : g}</td>
                  <td className="text-center py-1.5 px-2">{o === "✓" ? <span className="text-emerald-500">✓</span> : o === "✗" ? <span className="text-rose-500">✗</span> : o}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Analysis scratchpad */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 space-y-2">
        <div className="text-[10px] font-mono font-bold uppercase text-zinc-400">Analysis Notes</div>
        <input
          value={analysisTarget}
          onChange={(e) => setAnalysisTarget(e.target.value)}
          placeholder="Binary target (e.g. /usr/bin/myapp, suspect.exe)"
          className="w-full text-xs font-mono px-2.5 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-rose-500"
        />
        <textarea
          value={analysisNotes}
          onChange={(e) => setAnalysisNotes(e.target.value)}
          rows={3}
          placeholder="Document findings: symbol names, extracted strings, library dependencies, suspicious patterns…"
          className="w-full text-xs font-mono px-2.5 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-rose-500 resize-none"
        />
      </div>
    </div>
  );
}

// ── JS Deobfuscation Engine ──────────────────────────────────────────────────

function decodeHexStrings(code) {
  const decoded = [];
  let out = code.replace(/\\x([0-9a-fA-F]{2})/g, (m, h) => {
    const ch = String.fromCharCode(parseInt(h, 16));
    decoded.push({ original: m, decoded: ch, type: "hex-escape" });
    return ch;
  });
  out = out.replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => {
    const ch = String.fromCharCode(parseInt(h, 16));
    decoded.push({ original: m, decoded: ch, type: "unicode-escape" });
    return ch;
  });
  return { code: out, findings: decoded };
}

function extractStringArray(code) {
  const findings = [];
  const re = /(?:var|let|const)\s+(\w+)\s*=\s*\[([^\]]{20,})\]/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const items = m[2].match(/'[^']*'|"[^"]*"/g) || [];
    if (items.length > 5) {
      findings.push({
        varName: m[1],
        count: items.length,
        preview: items.slice(0, 8).map((s) => s.slice(1, -1)),
        full: items.map((s) => s.slice(1, -1)),
        line: code.substring(0, m.index).split("\n").length,
      });
    }
  }
  return findings;
}

function resolveShuffler(code) {
  const findings = [];
  const iifeRe = /\(function\((\w+),\s*(\w+)\)\s*\{[^}]*while\(!!\[\]\)\{try\{[^}]*parseInt[^}]*\}catch\((\w+)\)\{\1\['push'\]\(\1\['shift'\]\(\)\)\}\}\}\)\((\w+),\s*(0x[0-9a-f]+|\d+)\)/g;
  let m;
  while ((m = iifeRe.exec(code)) !== null) {
    findings.push({
      type: "array-shuffler",
      varName: m[4],
      target: parseInt(m[5], 16) || parseInt(m[5]),
      offset: m.index,
    });
  }
  return findings;
}

function extractPropertyAccessors(code) {
  const findings = [];
  const re = /const\s+(\w+)\s*=\s*(\w+);\s*\(function\((\w+),\s*(\w+)\)\s*\{[^}]*\}\)\((\w+),\s*0x[0-9a-f]+\)/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    findings.push({
      accessorFn: m[2],
      arrayVar: m[5],
      line: code.substring(0, m.index).split("\n").length,
    });
  }
  return findings;
}

function extractSecrets(code) {
  const findings = [];
  const patterns = [
    { re: /(?:(?:api[_-]?key|apikey|secret|token|password|passwd|auth)[\s:=]+["'])([A-Za-z0-9_\-\.]{16,})["']/gi, type: "credential" },
    { re: /(?:https?:\/\/[^\s"'<>]{10,})/gi, type: "url" },
    { re: /(?:[a-z0-9_\-]+\.)*(?:openai|anthropic|gemini|googleapis|aws|azure|blender|codex)[^\s"'<>]{5,}/gi, type: "api-endpoint" },
    { re: /(?:sk-|key-|pk-|rk-)[A-Za-z0-9]{20,}/g, type: "api-key" },
    { re: /(?:eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,})/g, type: "jwt" },
  ];
  for (const { re, type } of patterns) {
    let m;
    while ((m = re.exec(code)) !== null) {
      const match = m[0];
      if (findings.some((f) => f.value === match)) continue;
      findings.push({ type, value: match, index: m.index });
    }
  }
  return findings;
}

function flattenNested(code) {
  let changes = 0;
  let out = code;
  const nestedRe = /\{[\s]*\{([^{}]+)\}[\s]*\}/g;
  out = out.replace(nestedRe, (m, inner) => { changes++; return `{${inner}}`; });
  const voidRe = /void\s+0/g;
  out = out.replace(voidRe, () => { changes++; return "undefined"; });
  const commaRe = /,\s*,/g;
  out = out.replace(commaRe, () => { changes++; return ","; });
  return { code: out, changes };
}

function resolveIIFEShuffler(code) {
  let resolved = 0;
  let output = code;

  function parseArrayItems(str) {
    const items = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (!inQuote && (ch === "'" || ch === '"')) { inQuote = true; quoteChar = ch; }
      else if (inQuote && ch === '\\') { current += ch + (str[i + 1] || ''); i++; }
      else if (inQuote && ch === quoteChar) { inQuote = false; items.push(current); current = ''; }
      else if (inQuote) { current += ch; }
    }
    return items;
  }

  function extractArrayItems(c) {
    const fnRe = /function\s+(\w+)\s*\(\s*\)\s*\{\s*(?:const|var)\s+\w+\s*=\s*\[((?:[^\[\]]|\[[^\]]*\])*)\]/;
    const fnMatch = c.match(fnRe);
    if (fnMatch) return { fnName: fnMatch[1], items: parseArrayItems(fnMatch[2]) };
    const directRe = /function\s+(\w+)\s*\(\s*\)\s*\{\s*var\s+\w+\s*=\s*\[([^\]]+)\]/;
    const directMatch = c.match(directRe);
    if (directMatch) return { fnName: directMatch[1], items: parseArrayItems(directMatch[2]) };
    const assignRe = /(?:const|var|let)\s+(\w+)\s*=\s*\[([^\]]+)\]/;
    const assignMatch = c.match(assignRe);
    if (assignMatch) return { fnName: assignMatch[1], items: parseArrayItems(assignMatch[2]) };
    return null;
  }

  function extractOffsetVal(c) {
    const re = /function\s+(\w+)\s*\(\s*(\w+)\s*,\s*\w+\s*\)\s*\{\s*\2\s*=\s*\2\s*-\s*(0x[0-9a-f]+|\d+)/;
    const m = c.match(re);
    if (m) return { fnName: m[1], offset: parseInt(m[3], 16) || parseInt(m[3]) };
    return null;
  }

  function resolveAliases(c, fnName) {
    const aliases = new Set([fnName]);
    let prev = 0;
    while (aliases.size !== prev) {
      prev = aliases.size;
      for (const existing of aliases) {
        const esc = existing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`(?:const|var|let)\\s+(\\w+)\\s*=\\s*${esc}\\b`, 'g');
        let m;
        while ((m = re.exec(c)) !== null) aliases.add(m[1]);
      }
    }
    return [...aliases];
  }

  const bundleRe = /(?:const|var|let)\s+(\w+)\s*=\s*(\w+)\s*;[\s\S]*?\}\}\}\)\((\w+),(0x[0-9a-f]+)\)/g;
  let bundleMatch;
  const bundles = [];
  while ((bundleMatch = bundleRe.exec(code)) !== null) {
    bundles.push({ alias: bundleMatch[1], offsetFn: bundleMatch[2], arrayVar: bundleMatch[3], target: bundleMatch[4], index: bundleMatch.index });
  }

  // Pass 1: Build registries of all arrays and offsets
  const arrayReg = {};
  const offsetReg = {};
  const arrayByHash = {};
  for (const b of bundles) {
    const searchStart = Math.max(0, b.index - 2000);
    const codeSlice = code.slice(searchStart, b.index + 10000);
    const arr = extractArrayItems(codeSlice);
    if (arr && arr.items.length > 0) {
      if (!arrayReg[arr.fnName]) arrayReg[arr.fnName] = arr.items;
      const hash = arr.items.join('|').slice(0, 80);
      if (!arrayByHash[hash]) arrayByHash[hash] = arr.items;
    }
    const off = extractOffsetVal(codeSlice);
    if (off && offsetReg[off.fnName] === undefined) offsetReg[off.fnName] = off.offset;
  }

  // Pass 2: Decompile each bundle
  for (const bundle of bundles) {
    const searchStart = Math.max(0, bundle.index - 2000);
    const codeSlice = code.slice(searchStart, bundle.index + 10000);

    let items = null;
    const localArr = extractArrayItems(codeSlice);
    if (localArr && localArr.items.length > 0) items = localArr.items;
    else if (arrayReg[bundle.arrayVar]) items = arrayReg[bundle.arrayVar];
    else {
      const all = Object.values(arrayByHash);
      if (all.length > 0) items = all[0];
    }

    let offset = null;
    const localOff = extractOffsetVal(codeSlice);
    if (localOff) offset = localOff.offset;
    else if (offsetReg[bundle.offsetFn] !== undefined) offset = offsetReg[bundle.offsetFn];
    else {
      const aliasRe = /(?:const|var|let)\s+\w+\s*=\s*(\w+)\s*;/;
      const am = codeSlice.match(aliasRe);
      if (am && offsetReg[am[1]] !== undefined) offset = offsetReg[am[1]];
    }

    if (!items || items.length === 0 || offset === null) continue;

    const aliases = new Set();
    for (const refFn of Object.keys(offsetReg)) {
      if (codeSlice.includes(refFn + ';') || codeSlice.includes(refFn + ',')) {
        resolveAliases(codeSlice, refFn).forEach(a => aliases.add(a));
      }
    }
    const iifeRe = /\(function\s*\(\s*\w+\s*,\s*\w+\s*\)\s*\{(?:const|var|let)\s+(\w+)\s*=\s*(\w+)/;
    const iifeM = codeSlice.match(iifeRe);
    if (iifeM) {
      resolveAliases(codeSlice, iifeM[1]).forEach(a => aliases.add(a));
      resolveAliases(codeSlice, iifeM[2]).forEach(a => aliases.add(a));
    }
    if (aliases.size === 0) {
      const callRe2 = /(\w+)\s*\(\s*0x[0-9a-f]+\s*\)/g;
      let cm;
      while ((cm = callRe2.exec(codeSlice)) !== null) {
        if (!['parseInt', 'Number', 'Array', 'BigInt'].includes(cm[1])) aliases.add(cm[1]);
      }
    }

    const lookup = (hexIndex) => {
      const index = parseInt(hexIndex, 16) || parseInt(hexIndex);
      const actualIndex = (index - offset) % items.length;
      const idx = actualIndex < 0 ? actualIndex + items.length : actualIndex;
      return items[idx];
    };

    for (const alias of aliases) {
      const esc = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const callRe = new RegExp(`${esc}\\s*\\(\\s*(0x[0-9a-f]+|\\d+)\\s*\\)`, 'g');
      output = output.replace(callRe, (m, hexStr) => {
        const val = lookup(hexStr);
        if (val !== undefined) { resolved++; return JSON.stringify(val); }
        return m;
      });
    }
  }

  // Pass 3: Brute-force remaining calls
  const builtins = new Set(['parseInt', 'Number', 'Array', 'BigInt', 'String', 'Object', 'JSON', 'Math', 'Date']);
  const allArrays = [...new Set([...Object.values(arrayReg), ...Object.values(arrayByHash)])];
  const allOffsets = Object.values(offsetReg);
  const remaining = output.match(/(\w+)\s*\(\s*0x[0-9a-f]+\s*\)/g) || [];
  const uniqueFns = [...new Set(remaining.map(c => c.split('(')[0].trim()))].filter(f => !builtins.has(f));

  for (const fnName of uniqueFns) {
    for (const items of allArrays) {
      for (const offset of allOffsets) {
        const lookup = (hexIndex) => {
          const index = parseInt(hexIndex, 16) || parseInt(hexIndex);
          const actualIndex = (index - offset) % items.length;
          const idx = actualIndex < 0 ? actualIndex + items.length : actualIndex;
          return items[idx];
        };
        const esc = fnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const callRe = new RegExp(`${esc}\\s*\\(\\s*(0x[0-9a-f]+|\\d+)\\s*\\)`, 'g');
        const matches = output.match(callRe) || [];
        if (matches.length === 0) continue;
        let valid = 0;
        for (const match of matches) {
          const hex = match.match(/0x[0-9a-f]+/)?.[0];
          if (hex) { const v = lookup(hex); if (v && typeof v === 'string' && v.length > 0) valid++; }
        }
        if (valid > matches.length * 0.5) {
          output = output.replace(callRe, (m, hexStr) => {
            const val = lookup(hexStr);
            if (val !== undefined && typeof val === 'string' && val.length > 0) { resolved++; return JSON.stringify(val); }
            return m;
          });
        }
      }
    }
  }

  return { code: output, resolved };
}

function analyzeControlFlow(code) {
  const findings = [];
  const evalRe = /\beval\s*\(/g;
  const funcRe = /\bFunction\s*\(/g;
  const withRe = /\bwith\s*\(/g;
  let m;
  while ((m = evalRe.exec(code)) !== null) findings.push({ type: "eval()", index: m.index });
  while ((m = funcRe.exec(code)) !== null) findings.push({ type: "Function()", index: m.index });
  while ((m = withRe.exec(code)) !== null) findings.push({ type: "with()", index: m.index });
  return findings;
}

function renameObfuscatedVars(code) {
  const findings = [];
  const seen = new Map();
  let id = 0;
  const shortVarRe = /(?<![.\w])(?:_0x[a-f0-9]+)(?![.\w])/g;
  let out = code.replace(shortVarRe, (m) => {
    if (!seen.has(m)) {
      seen.set(m, `_ref${id++}`);
      findings.push({ original: m, renamed: `_ref${id - 1}` });
    }
    return seen.get(m);
  });
  return { code: out, findings, count: findings.length };
}

function deobfuscate(code) {
  const steps = [];
  let current = code;

  const s1 = decodeHexStrings(current);
  current = s1.code;
  steps.push({ name: "Hex/Unicode Decode", found: s1.findings.length, detail: s1.findings.slice(0, 10) });

  const s2 = extractStringArray(current);
  steps.push({ name: "String Array Extraction", found: s2.length, detail: s2 });

  const s3 = resolveShuffler(current);
  steps.push({ name: "Shuffler Detection", found: s3.length, detail: s3 });

  const s4 = extractPropertyAccessors(current);
  steps.push({ name: "Property Accessor Mapping", found: s4.length, detail: s4 });

  const s5 = flattenNested(current);
  current = s5.code;
  steps.push({ name: "Nested Brace Flatten", found: s5.changes, detail: [] });

  const s5b = resolveIIFEShuffler(current);
  current = s5b.code;
  steps.push({ name: "IIFE Shuffler Resolve", found: s5b.resolved, detail: [] });

  const s6 = analyzeControlFlow(current);
  steps.push({ name: "Control Flow Analysis", found: s6.length, detail: s6 });

  const s7 = extractSecrets(current);
  steps.push({ name: "Secret/Endpoint Extraction", found: s7.length, detail: s7 });

  const s8 = renameObfuscatedVars(current);
  current = s8.code;
  steps.push({ name: "Variable Rename", found: s8.count, detail: s8.findings.slice(0, 10) });

  return {
    originalLen: code.length,
    deobfuscated: current,
    totalFindings: steps.reduce((a, s) => a + s.found, 0),
    steps,
  };
}

function Deobfuscator() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState("input");

  const run = () => {
    if (!input.trim()) return;
    setResult(deobfuscate(input));
    setTab("results");
  };

  const copyOutput = () => {
    if (!result?.deobfuscated) return;
    navigator.clipboard.writeText(result.deobfuscated);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const loadSample = () => {
    setInput(`function a(){const k=['\\x7b\\x22colors\\x22\\x3a\\x22#2A2A37\\x22\\x7d','length','isRoot','width','mindmap','call','addNode','yylineno','shape','icon','parse','prototype','end\\x20of'];
return k;}
function b(c,d){c=c-0xe3;const e=a();let f=e[c];return f;}
const j=b;
(function(c,d){const i=b,f=c();while(!![]){try{const g=parseInt(i(0xea))/0x1+parseInt(i(0xeb))/0x2+parseInt(i(0xec))/0x3+-parseInt(i(0xe3))/0x4+parseInt(i(0xe6))/0x5+-parseInt(i(0xe5))/0x6*(-parseInt(i(0xe9))/0x7)+-parseInt(i(0xe7))/0x8;if(g===d)break;else f['push'](f['shift']());}catch(h){f['push'](f['shift']());}}})(a,0xa9d29);
const e=Object[j(0xe8)](JSON['parse'](j(0xe4)));
var config={"colors":{"activityBar.background":"#2A2A37","activityBar.foreground":"#DCD7BA"}};
const apiToken="sk-proj-abc123def456ghi789jkl012mno";
fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Authorization":"Bearer "+apiToken}});
console[j(0xe3)](e);`);
  };

  const card = "rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 space-y-2";
  const inputCls = "text-xs font-mono px-2.5 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-rose-500";
  const btn = "flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50";
  const SEV = { credential: "text-rose-500", url: "text-sky-500", "api-endpoint": "text-amber-500", "api-key": "text-rose-500", jwt: "text-orange-500" };

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex items-center gap-2">
          <Wand2 className="h-5 w-5 text-rose-500" />
          <div>
            <div className="text-sm font-bold">JavaScript Deobfuscator</div>
            <div className="text-[10px] text-zinc-400">Decode hex escapes, resolve variable shuffling, extract secrets, and recover readable code</div>
          </div>
        </div>
      </div>

      <div className="flex gap-1">
        {[["input", "Input", FileSearch], ["results", "Results", Braces], ["secrets", "Secrets", KeyRound]].map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)} className={`${btn} ${tab === id ? "border-rose-500 text-rose-500 bg-rose-500/5" : ""}`}><Icon className="h-3 w-3" /> {label}</button>
        ))}
      </div>

      {tab === "input" && (
        <div className="space-y-3">
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={12} placeholder="Paste obfuscated JavaScript here..." className={`${inputCls} w-full resize-none`} spellCheck={false} />
          <div className="flex gap-2">
            <button onClick={run} disabled={!input.trim()} className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
              <Wand2 className="h-4 w-4" /> Deobfuscate
            </button>
            <button onClick={loadSample} className={btn}>Load sample</button>
          </div>
        </div>
      )}

      {tab === "results" && result && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <div className={`${card} text-center`}>
              <div className="text-lg font-bold text-rose-500">{result.totalFindings}</div>
              <div className="text-[10px] text-zinc-400">Total findings</div>
            </div>
            <div className={`${card} text-center`}>
              <div className="text-lg font-bold text-sky-500">{result.originalLen.toLocaleString()}</div>
              <div className="text-[10px] text-zinc-400">Original size</div>
            </div>
            <div className={`${card} text-center`}>
              <div className="text-lg font-bold text-emerald-500">{result.deobfuscated.length.toLocaleString()}</div>
              <div className="text-[10px] text-zinc-400">Deobfuscated size</div>
            </div>
            <div className={`${card} text-center`}>
              <div className="text-lg font-bold text-amber-500">{result.steps.length}</div>
              <div className="text-[10px] text-zinc-400">Analysis passes</div>
            </div>
          </div>

          <div className={card}>
            <div className="text-[10px] font-mono font-bold uppercase text-zinc-400 mb-2">Analysis Pipeline</div>
            <div className="space-y-1">
              {result.steps.map((s, i) => (
                <div key={i} className="flex items-center gap-3 text-[11px] font-mono">
                  <span className="text-zinc-500 w-4">{i + 1}.</span>
                  <span className="flex-1 text-zinc-600 dark:text-zinc-300">{s.name}</span>
                  <span className={`font-bold ${s.found > 0 ? "text-rose-500" : "text-emerald-500"}`}>{s.found} found</span>
                </div>
              ))}
            </div>
          </div>

          <div className={card}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] font-mono font-bold uppercase text-zinc-400 flex items-center gap-1"><Braces className="h-3.5 w-3.5" /> Deobfuscated Output</div>
              <div className="flex gap-1">
                <button onClick={copyOutput} className={btn}><Copy className="h-3 w-3" /> {copied ? "Copied!" : "Copy"}</button>
              </div>
            </div>
            <pre className="p-3 rounded-lg bg-zinc-950 border border-zinc-900 text-[10px] font-mono text-zinc-300 overflow-x-auto max-h-96 leading-relaxed whitespace-pre-wrap">{result.deobfuscated}</pre>
          </div>

          {/* String array tables */}
          {result.steps.find((s) => s.name === "String Array Extraction" && s.found > 0) && (
            <div className={card}>
              <div className="text-[10px] font-mono font-bold uppercase text-zinc-400 mb-2 flex items-center gap-1"><Hash className="h-3.5 w-3.5" /> Extracted String Arrays</div>
              {result.steps.filter((s) => s.name === "String Array Extraction")[0]?.detail.map((arr, i) => (
                <div key={i} className="mb-3">
                  <div className="text-[10px] font-mono text-rose-500 mb-1">var {arr.varName} ({arr.count} items, line ~{arr.line})</div>
                  <div className="flex flex-wrap gap-1">
                    {arr.full.map((s, j) => (
                      <span key={j} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">{s}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Shuffler map */}
          {result.steps.find((s) => s.name === "Shuffler Detection" && s.found > 0) && (
            <div className={card}>
              <div className="text-[10px] font-mono font-bold uppercase text-zinc-400 mb-2">Shuffler Patterns Detected</div>
              {result.steps.filter((s) => s.name === "Shuffler Detection")[0]?.detail.map((sh, i) => (
                <div key={i} className="flex items-center gap-3 text-[11px] font-mono">
                  <span className="text-amber-500">IIFE shuffler</span>
                  <span className="text-zinc-400">target array:</span>
                  <span className="text-zinc-600 dark:text-zinc-300 font-bold">{sh.varName}</span>
                  <span className="text-zinc-400">offset: 0x{sh.target.toString(16)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "secrets" && result && (
        <div className="space-y-3">
          {(() => {
            const secretStep = result.steps.find((s) => s.name === "Secret/Endpoint Extraction");
            const items = secretStep?.detail || [];
            if (!items.length) return <div className={card}><div className="text-xs text-zinc-400 font-mono">No secrets or endpoints detected in the input.</div></div>;
            return items.map((item, i) => (
              <div key={i} className={`${card} border-l-2 ${item.type === "credential" || item.type === "api-key" || item.type === "jwt" ? "border-l-rose-500" : "border-l-sky-500"}`}>
                <div className="flex items-center gap-2">
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded uppercase font-bold ${SEV[item.type] || "text-zinc-400"} bg-zinc-100 dark:bg-zinc-800`}>{item.type}</span>
                </div>
                <pre className="mt-1 text-[10px] font-mono text-zinc-600 dark:text-zinc-300 break-all whitespace-pre-wrap">{item.value}</pre>
              </div>
            ));
          })()}
        </div>
      )}
    </div>
  );
}

// Curated scanner sets exposed to the console (defensive + repo). Names must
// match SCANNER_MAP on the Sentinel backend.
const SCANNER_SETS = {
  "Web (quick)": ["headers", "tls_audit", "cors_test", "auth_test", "tech_fingerprint"],
  "Web (full)": ["headers", "tls_audit", "cors_test", "auth_test", "vuln_scan", "api_security",
    "sqli_test", "xss_test", "ssrf_test", "open_redirect", "host_header", "waf_detect",
    "subdomain_takeover", "cloud_misconfig"],
  "Infra / DNS": ["port_scan", "dns_enum", "service_detect", "cert_audit", "dns_audit", "caddy_audit"],
  "Repository": ["repo_scan"],
};
const SEV_COLOR = { critical: "text-rose-500", high: "text-orange-500", medium: "text-amber-500", low: "text-sky-500", info: "text-zinc-400" };

function download(name, text) {
  const b = new Blob([text], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(b); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function SentinelAPI({ projectId, token, stored, onStoreToken, onRemoveToken, credentialNote }) {
   const mod = MODULES.find((m) => m.id === "redteam");
   const [url, setUrl] = useState(moduleUrl(mod));
   const [tokenDraft, setTokenDraft] = useState("");
   const [targets, setTargets] = useState([]);
   const [newVal, setNewVal] = useState("");
   const [newType, setNewType] = useState("domain");
   const [scanTargets, setScanTargets] = useState("");
   const [repoUrl, setRepoUrl] = useState("");
   const [preset, setPreset] = useState("Web (quick)");
   const [scanners, setScanners] = useState(SCANNER_SETS["Web (quick)"]);
   const [batch, setBatch] = useState(null);
   const [report, setReport] = useState(null);
   const [note, setNote] = useState(null);
   const [busy, setBusy] = useState(null);
   const pollRef = React.useRef(null);

   const mixed = typeof window !== "undefined" && window.location.protocol === "https:" && /^http:\/\//.test(url);
   const authed = !!token;

   const call = (path, opts = {}) => { setModuleUrl("redteam", url); return callModule("redteam", path, { token: token || undefined, projectId, ...opts }); };
   const flash = (msg, ok = true) => setNote({ msg, ok });

  // --- targets: list / add / remove ---
  const loadTargets = async () => {
    setBusy("targets"); const r = await call("/targets"); setBusy(null);
    if (r.ok) setTargets(Array.isArray(r.data?.data) ? r.data.data : []);
    else flash(r?.data?.message || r?.error || "list failed", false);
  };
  const addTarget = async () => {
    if (!newVal.trim()) return;
    setBusy("addTarget");
    const r = await call("/targets", { method: "POST", body: { target_type: newType, value: newVal.trim(), name: newVal.trim() } });
    setBusy(null);
    if (r.ok) { setNewVal(""); flash("Target added"); loadTargets(); } else flash(r?.data?.message || r?.error || "add failed", false);
  };
  const removeTarget = async (id) => {
    setBusy("rm" + id);
    const r = await call(`/targets/${id}`, { method: "DELETE" });
    setBusy(null);
    if (r.ok) { setTargets((t) => t.filter((x) => x.id !== id)); flash("Target removed"); } else flash(r?.data?.message || r?.error || "remove failed", false);
  };

  // --- scan: real parallel engine (/api/scan/parallel, outside /api/v1) ---
  const applyPreset = (p) => { setPreset(p); setScanners(SCANNER_SETS[p]); };
  const startScan = async (targetList, forcedScanners) => {
    const tgts = targetList.map((s) => s.trim()).filter(Boolean);
    const scs = forcedScanners || scanners;
    if (!tgts.length || !scs.length) { flash("Need at least one target and one scanner", false); return; }
    setReport(null); setBusy("scan");
    const r = await call("/api/scan/parallel", { method: "POST", apiBase: "", body: { targets: tgts, scanners: scs } });
    setBusy(null);
    const id = r?.data?.batch_id;
    if (!id) { flash(r?.data?.error || r?.error || `scan failed (${r?.status || "?"})`, false); return; }
    setBatch({ batch_id: id, status: "running", total: r.data.jobs, completed: 0, results: {} });
    flash(`Scan started — ${tgts.length} target(s) × ${scs.length} scanner(s)`);
    poll(id);
  };
  const poll = (id) => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const r = await call(`/api/scan/${id}`, { apiBase: "" });
      if (r.ok && r.data) {
        setBatch(r.data);
        if (r.data.status !== "running") clearInterval(pollRef.current);
      }
    }, 2500);
  };
  React.useEffect(() => () => clearInterval(pollRef.current), []);

  // --- report: remediation report from the finished batch ---
  const genReport = async () => {
    if (!batch?.batch_id) return;
    setBusy("report");
    const r = await call("/reports", { method: "POST", body: { batch_id: batch.batch_id } });
    setBusy(null);
    if (r.ok) { setReport(r.data?.data); flash("Report generated"); } else flash(r?.data?.message || r?.error || "report failed", false);
  };

  // aggregate findings from batch results for a live summary
  const findings = batch?.results ? Object.values(batch.results).flatMap((x) => (x?.findings || []).map((f) => ({ ...f, scanner: x.scanner }))) : [];
  const counts = findings.reduce((a, f) => { const s = (f.severity || "info").toLowerCase(); a[s] = (a[s] || 0) + 1; return a; }, {});

  const input = "text-xs font-mono px-2.5 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-rose-500";
  const btn = "flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50";
  const card = "rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 space-y-2";
  const head = "text-[10px] font-mono font-bold uppercase text-zinc-400";

  return (
    <div className="space-y-4">
      {/* connection + auth */}
      <div className={card}>
        <div className="flex items-center gap-2 flex-wrap">
          <input value={url} onChange={(e) => setUrl(e.target.value)} onBlur={() => setModuleUrl("redteam", url)} title="Sentinel base URL" className={`${input} w-56`} />
          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${authed ? "bg-emerald-500/10 text-emerald-500" : "bg-zinc-500/10 text-zinc-400"}`}>{authed ? "project token active" : "no project token"}</span>
          <span className="text-[10px] font-mono text-zinc-400">project: {projectId || "none selected"}</span>
        </div>
        {!authed && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <input type="password" value={tokenDraft} onChange={(e) => setTokenDraft(e.target.value)} placeholder={stored ? "unlock Vault to use stored token" : "Sentinel bearer token"} aria-label="Sentinel access token" className={`${input} min-w-64 flex-1`} />
            <button onClick={async () => { const result = await onStoreToken(tokenDraft); if (result.ok) setTokenDraft(""); }} disabled={!projectId || tokenDraft.trim().length < 20 || !!busy} className={btn}><KeyRound className="h-3 w-3" /> Store for project</button>
          </div>
        )}
        {authed && <button onClick={() => { onRemoveToken(); setTargets([]); }} className={`${btn} w-fit`}>Remove project token</button>}
        <div className={`text-[10px] font-mono ${credentialNote?.ok === false ? "text-amber-500" : "text-zinc-400"}`}>{credentialNote?.msg || "A service-issued Sentinel bearer token is encrypted under the signed-in user and active project. Account passwords are never accepted here."}</div>
      </div>
        {note && <div className={`rounded-lg border p-2 text-[11px] font-mono ${note.ok ? "border-emerald-500/30 text-emerald-500" : "border-rose-500/30 text-rose-500"}`}>{note.msg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* 1 · Attack surface targets */}
        <div className={card}>
          <div className="flex items-center justify-between"><div className={head}>1 · Attack-surface targets</div><button onClick={loadTargets} disabled={!authed || !!busy} className={btn}>{busy === "targets" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radar className="h-3 w-3" />} Refresh</button></div>
          <div className="flex gap-1.5">
            <input value={newVal} onChange={(e) => setNewVal(e.target.value)} placeholder="example.com / https://app / 10.0.0.1" className={`${input} flex-1`} />
            <select value={newType} onChange={(e) => setNewType(e.target.value)} className={input}><option>domain</option><option>url</option><option>ip</option><option>api</option><option>repo</option></select>
            <button onClick={addTarget} disabled={!authed || !!busy} className={btn}>Add</button>
          </div>
          <div className="space-y-1 max-h-40 overflow-auto">
            {targets.length === 0 && <div className="text-[11px] text-zinc-400 font-mono">No targets. {authed ? "Add one above." : "Store a project-scoped token to manage targets."}</div>}
            {targets.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2 text-[11px] font-mono rounded border border-zinc-100 dark:border-zinc-800 px-2 py-1">
                <span className="truncate"><span className="text-zinc-400">{t.target_type}</span> {t.value}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <button title="Scan this" onClick={() => { setScanTargets(t.value); startScan([t.value]); }} className="text-sky-500 hover:underline">scan</button>
                  <button title="Remove" onClick={() => removeTarget(t.id)} disabled={!!busy} className="text-rose-500 hover:underline">{busy === "rm" + t.id ? "…" : "remove"}</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 2 · Scan */}
        <div className={card}>
          <div className={head}>2 · Scan (URL / host)</div>
          <input value={scanTargets} onChange={(e) => setScanTargets(e.target.value)} placeholder="targets, comma or newline separated" className={`${input} w-full`} />
          <div className="flex flex-wrap gap-1">
            {Object.keys(SCANNER_SETS).map((p) => (
              <button key={p} onClick={() => applyPreset(p)} className={`text-[10px] px-2 py-1 rounded-md border ${preset === p ? "border-rose-500 text-rose-500" : "border-zinc-200 dark:border-zinc-700 text-zinc-500"}`}>{p}</button>
            ))}
          </div>
          <div className="text-[10px] font-mono text-zinc-400">{scanners.length} scanners: {scanners.join(", ")}</div>
          <button onClick={() => startScan(scanTargets.split(/[\n,]/))} disabled={!authed || !!busy} className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
            {busy === "scan" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />} Launch scan
          </button>
        </div>

        {/* 3 · Repository scan */}
        <div className={card}>
          <div className={head}>3 · Repository scan (secrets + risky code)</div>
          <input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/owner/repo  or  owner/repo" className={`${input} w-full`} />
          <button onClick={() => startScan([repoUrl], ["repo_scan"])} disabled={!authed || !!busy || !repoUrl.trim()} className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
            {busy === "scan" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Server className="h-4 w-4" />} Scan repository
          </button>
          <div className="text-[10px] font-mono text-zinc-400">Fetches the repo tarball server-side (no clone) and flags leaked secrets, hardcoded creds, and risky patterns. Private GitHub repos need GITHUB_TOKEN set on Sentinel.</div>
        </div>

        {/* 4 · Report */}
        <div className={card}>
          <div className={head}>4 · Remediation report</div>
          <button onClick={genReport} disabled={!authed || !!busy || !batch || batch.status === "running"} className={btn}>
            {busy === "report" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldAlert className="h-3.5 w-3.5" />} Generate report from last scan
          </button>
          {report && <button onClick={() => download(`sentinel-report-${Date.now()}.md`, report.markdown)} className={`${btn} w-fit`}>Download .md</button>}
          <div className="text-[10px] font-mono text-zinc-400">Turns the last scan's findings into a prioritized fix plan (concrete patches per finding).</div>
        </div>
      </div>

      {/* live scan progress + findings */}
      {batch && (
        <div className={card}>
          <div className="flex items-center gap-2 text-[11px] font-mono">
            <span className={batch.status === "running" ? "text-amber-500" : "text-emerald-500"}>{batch.status === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin inline" /> : <CheckCircle2 className="h-3.5 w-3.5 inline" />} {batch.status}</span>
            <span className="text-zinc-400">{batch.completed}/{batch.total} jobs</span>
            {Object.entries(counts).map(([s, n]) => <span key={s} className={SEV_COLOR[s] || "text-zinc-400"}>{n} {s}</span>)}
          </div>
          <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden"><div className="h-full bg-rose-500 transition-all" style={{ width: `${batch.total ? (batch.completed / batch.total) * 100 : 0}%` }} /></div>
          <div className="space-y-1 max-h-64 overflow-auto">
            {findings.length === 0 && batch.status !== "running" && <div className="text-[11px] font-mono text-emerald-500">No findings — clean.</div>}
            {findings.slice(0, 60).map((f, i) => (
              <div key={i} className="text-[11px] font-mono rounded border border-zinc-100 dark:border-zinc-800 px-2 py-1">
                <span className={`font-bold ${SEV_COLOR[(f.severity || "info").toLowerCase()] || "text-zinc-400"}`}>[{(f.severity || "info").toUpperCase()}]</span> {f.title}
                {f.endpoint && <span className="text-zinc-400"> · {f.endpoint}</span>}
                {(f.remediation || f.patch) && <div className="text-zinc-500 mt-0.5">↳ {f.patch || f.remediation}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* rendered report */}
      {report && (
        <div className={card}>
          <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400">
            Report · {report.total} findings · {report.remediation_plan?.length || 0} prioritized fixes
          </div>
          <pre className="whitespace-pre-wrap text-[11px] text-zinc-600 dark:text-zinc-300 max-h-80 overflow-auto">{report.markdown}</pre>
        </div>
      )}
    </div>
  );
}

function StrixPentest({ projectId, token }) {
   const [target, setTarget] = useState("");
   const [inScope, setInScope] = useState("");
   const [engine, setEngine] = useState("gemini-pro");
   const [validationMode, setValidationMode] = useState(true);
   const [deployedAgents, setDeployedAgents] = useState({
     recon: true,
     vuln: true,
     exploit: true,
     reporter: true
   });

   const [status, setStatus] = useState("idle");
   const [logs, setLogs] = useState([]);
   const [batch, setBatch] = useState(null);
   const [selectedFinding, setSelectedFinding] = useState(null);
   const [copied, setCopied] = useState(null);
   const [note, setNote] = useState(null);
   const pollRef = React.useRef(null);

   const authed = !!token;
   const hasProject = !!projectId;

   const agentScanners = {
     recon: ["headers", "tls_audit", "cors_test", "auth_test", "tech_fingerprint"],
     vuln: ["vuln_scan", "sqli_test", "xss_test", "ssrf_test", "open_redirect"],
     exploit: ["auth_test", "api_security"],
   };

   const startScan = async () => {
     if (!target.trim()) return;
     if (!hasProject || !authed) { setNote({ msg: "Connect to Sentinel — sign in and select a project to run pentests.", ok: false }); return; }
     setStatus("scanning");
     setLogs([]);
     setBatch(null);
     setSelectedFinding(null);
     setNote(null);

     const scanners = [...new Set(Object.entries(deployedAgents).filter(([, v]) => v).flatMap(([a]) => agentScanners[a] || []))];
     if (!scanners.length) { setStatus("idle"); setNote({ msg: "Enable at least one agent to select scanners.", ok: false }); return; }

     const tgts = target.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

     try {
       setLogs([{ agent: "Strix", msg: `Launching pentest — ${tgts.length} target(s) × ${scanners.length} scanner(s)`, time: "00:00", color: "text-rose-400" }]);
       const r = await callModule("redteam", "/api/scan/parallel", { method: "POST", apiBase: "", body: { targets: tgts, scanners } });
       if (!r.ok) { setStatus("idle"); setNote({ msg: r?.data?.error || r?.error || "Scan launch failed", ok: false }); return; }
       const id = r.data?.batch_id;
       if (!id) { setStatus("idle"); setNote({ msg: "Scan did not return a batch ID", ok: false }); return; }
       setLogs((l) => [...l, { agent: "Strix", msg: `Batch ${id} started`, time: "00:01", color: "text-emerald-400" }]);
       setBatch({ batch_id: id, status: "running", total: r.data?.jobs || 0, completed: 0, results: {} });
       poll(id);
     } catch (e) {
       setStatus("idle");
       setNote({ msg: `Scan failed: ${String(e.message || e)}`, ok: false });
     }
   };

   const poll = (id) => {
     clearInterval(pollRef.current);
     pollRef.current = setInterval(async () => {
       const r = await callModule("redteam", `/api/scan/${id}`, { apiBase: "" });
       if (r.ok && r.data) {
         setBatch(r.data);
         const completed = r.data.completed || 0;
         const total = r.data.total || 0;
         setLogs((l) => {
           const last = l[l.length - 1];
           if (last?.msg?.startsWith("Progress:")) return l;
           return [...l, { agent: "Strix", msg: `Progress: ${completed}/${total} jobs`, time: new Date().toLocaleTimeString(), color: "text-[var(--color-brand-primary)]" }];
         });
         if (r.data.status !== "running") {
           clearInterval(pollRef.current);
           setStatus("done");
           setLogs((l) => [...l, { agent: "Strix", msg: `Scan complete — ${r.data.status}`, time: new Date().toLocaleTimeString(), color: "text-emerald-400" }]);
         }
       }
     }, 2500);
   };

   React.useEffect(() => () => clearInterval(pollRef.current), []);

   const findings = batch?.results ? Object.values(batch.results).flatMap((x) => (x?.findings || []).map((f) => ({ ...f, scanner: x.scanner }))) : [];

   const copyToClipboard = (text, type) => {
     navigator.clipboard.writeText(text);
     setCopied(type);
     setTimeout(() => setCopied(null), 2000);
   };

   const downloadReport = () => {
     if (!target) return;
     let reportMarkdown = `# Strix Autonomous Penetration Testing Report\n\n`;
     reportMarkdown += `**Target:** ${target}\n`;
     reportMarkdown += `**In-Scope:** ${inScope || "(none)"}\n`;
     reportMarkdown += `**Exploit Validation:** ${validationMode ? "Active" : "Passive"}\n\n`;
     reportMarkdown += `## Confirmed Findings\n\n`;
     if (!findings.length) { reportMarkdown += "No findings.\n"; }
     findings.forEach((f) => {
       reportMarkdown += `### [${(f.severity || "info").toUpperCase()}] ${f.title || "Untitled finding"}\n`;
       reportMarkdown += `* **Endpoint:** \`${f.endpoint || "unknown"}\`\n\n`;
       if (f.description) reportMarkdown += `${f.description}\n\n`;
       if (f.remediation) reportMarkdown += `#### Remediation\n\`\`\`diff\n${f.remediation}\n\`\`\`\n\n`;
     });
     download(`strix-pentest-report-${Date.now()}.md`, reportMarkdown);
   };

  const SEV_BG = {
    critical: "bg-rose-500/10 text-rose-500 border border-rose-500/30",
    high: "bg-orange-500/10 text-orange-500 border border-orange-500/30",
    medium: "bg-amber-500/10 text-amber-500 border border-amber-500/30",
    low: "bg-sky-500/10 text-sky-500 border border-sky-500/30"
  };

  const card = "rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 space-y-2";
  const input = "text-xs font-mono px-2.5 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-rose-500";
  const btn = "flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Settings Panel */}
        <div className={`${card} lg:col-span-1 space-y-3`}>
          <div className="text-[10px] font-mono font-bold uppercase text-rose-500">Strix Pentest Config</div>
          <div className="space-y-2">
            <label className="block text-[10px] font-mono text-zinc-500">Target URL / Host
              <input value={target} onChange={(e) => setTarget(e.target.value)} disabled={status === "scanning"} placeholder="e.g. https://api-staging.actiora.com" className={`${input} w-full mt-1`} />
            </label>
            <label className="block text-[10px] font-mono text-zinc-500">In-Scope Path Prefix
              <input value={inScope} onChange={(e) => setInScope(e.target.value)} disabled={status === "scanning"} placeholder="e.g. /api/v2/*" className={`${input} w-full mt-1`} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[10px] font-mono text-zinc-500">AI LLM Model
                <select value={engine} onChange={(e) => setEngine(e.target.value)} disabled={status === "scanning"} className={`${input} w-full mt-1`}>
                  <option value="gemini-pro">Gemini Pro</option>
                  <option value="claude-3.5-sonnet">Claude 3.5 Sonnet</option>
                  <option value="gpt-4o">GPT-4o</option>
                </select>
              </label>
              <div className="flex flex-col justify-end">
                <button onClick={() => setValidationMode(!validationMode)} disabled={status === "scanning"} className={`w-full text-left rounded-lg border px-2 py-1.5 text-[10px] font-medium flex items-center justify-between \${validationMode ? "border-rose-500/40 text-rose-500" : "border-zinc-200 dark:border-zinc-800 text-zinc-500"}`}>
                  <span>Exploit Validate</span>
                  <span className={`h-2 w-2 rounded-full \${validationMode ? "bg-rose-500" : "bg-zinc-400"}`} />
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-[10px] font-mono text-zinc-500">Deployable Multi-Agents</div>
              <div className="grid grid-cols-2 gap-1.5">
                {Object.keys(deployedAgents).map((a) => (
                  <button key={a} disabled={status === "scanning"} onClick={() => setDeployedAgents((curr) => ({ ...curr, [a]: !curr[a] }))} className={`flex items-center justify-between text-[9px] font-mono px-2 py-1 rounded border \${deployedAgents[a] ? "border-rose-500/40 text-rose-500" : "border-zinc-200 dark:border-zinc-800 text-zinc-500"}`}>
                    <span className="capitalize">{a} Agent</span>
                    {deployedAgents[a] && <Check className="h-3 w-3 shrink-0" />}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <button onClick={startScan} disabled={status === "scanning" || !target.trim()} className="w-full flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
            {status === "scanning" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {status === "scanning" ? "Pentesting..." : "Start Autonomous Pentest"}
          </button>
        </div>

        {/* Thought Stream Console */}
        <div className={`\${card} lg:col-span-2 flex flex-col h-[340px] bg-zinc-950 text-zinc-200 border-zinc-900`}>
          <div className="flex items-center justify-between border-b border-zinc-900 pb-2">
            <span className="text-[10px] font-mono font-bold uppercase text-rose-500 flex items-center gap-1.5"><Terminal className="h-3.5 w-3.5" /> Agent Collaboration Thought Stream</span>
            <span className="text-[9px] font-mono text-zinc-600">strix-cli @ sandbox-sandbox</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 font-mono text-[10px] space-y-1.5 leading-relaxed">
            {logs.length === 0 && (
              <div className="text-zinc-600 italic">Configure a target and launch the pentest to view the multi-agent execution pipeline...</div>
            )}
            {logs.map((l, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-zinc-600">[{l.time}]</span>
                <span className={`font-bold shrink-0 \${l.color}`}>{l.agent}:</span>
                <span className="text-zinc-300">{l.msg}</span>
              </div>
            ))}
            {status === "scanning" && (
              <div className="flex items-center gap-2 text-rose-400 animate-pulse">
                <span>[scanning...]</span>
                <Loader2 className="h-3 w-3 animate-spin" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Findings and PoCs */}
      {findings.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Findings List */}
          <div className={`\${card} lg:col-span-1 space-y-2`}>
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-mono font-bold uppercase text-rose-500">Confirmed Findings</div>
              <button onClick={downloadReport} className={`\${btn} px-2 py-1`}>Download Report</button>
            </div>
            <div className="space-y-1.5 max-h-[350px] overflow-y-auto">
              {findings.map((f) => (
                <button key={f.id} onClick={() => setSelectedFinding(f)} className={`w-full text-left p-2.5 rounded-lg border transition-all \${selectedFinding?.id === f.id ? "border-rose-500 bg-rose-500/[0.04]" : "border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/40"}`}>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[8px] font-mono px-1 py-0.5 rounded font-bold uppercase \${SEV_BG[f.severity]}`}>{f.severity}</span>
                    <span className="text-xs font-semibold truncate flex-1">{f.title}</span>
                  </div>
                  <div className="text-[9px] font-mono text-zinc-400 mt-1 truncate">{f.endpoint}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Details & PoC Display */}
          {selectedFinding && (
            <div className={`\${card} lg:col-span-2 space-y-3`}>
              <div className="border-b border-zinc-200 dark:border-zinc-800 pb-2">
                <div className="flex items-center gap-2">
                  <span className={`text-[8px] font-mono px-1 py-0.5 rounded font-bold uppercase \${SEV_BG[selectedFinding.severity]}`}>{selectedFinding.severity}</span>
                  <h3 className="text-sm font-semibold">{selectedFinding.title}</h3>
                </div>
                <div className="text-[10px] font-mono text-zinc-400 mt-0.5">{selectedFinding.endpoint}</div>
              </div>
              
              <div className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">{selectedFinding.description}</div>

              {/* PoC Exploitation */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold uppercase text-zinc-400 flex items-center gap-1"><FileCode className="h-3.5 w-3.5" /> Proof of Concept (PoC) Exploit</span>
                  <button onClick={() => copyToClipboard(selectedFinding.poc, "poc")} className="text-[9px] font-mono text-rose-500 hover:underline">{copied === "poc" ? "Copied!" : "Copy code"}</button>
                </div>
                <pre className="p-3 rounded-lg bg-zinc-950 border border-zinc-900 text-[10px] font-mono text-zinc-300 overflow-x-auto max-h-48 leading-normal">{selectedFinding.poc}</pre>
              </div>

              {/* Remediation Plan */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold uppercase text-zinc-400 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> Remediation Plan (Patch)</span>
                  <button onClick={() => copyToClipboard(selectedFinding.remediation, "remediation")} className="text-[9px] font-mono text-rose-500 hover:underline">{copied === "remediation" ? "Copied!" : "Copy patch"}</button>
                </div>
                <pre className="p-3 rounded-lg bg-zinc-950 border border-zinc-900 text-[10px] font-mono text-zinc-300 overflow-x-auto max-h-48 leading-normal">{selectedFinding.remediation}</pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DePaywall() {
  const [activeTab, setActiveTab] = useState("auth");
  const [apiKeys, setApiKeys] = useState({
    openai: "",
    anthropic: "",
    google: "",
    mistral: ""
  });
  const [customEndpoint, setCustomEndpoint] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [testResult, setTestResult] = useState(null);
  const [copied, setCopied] = useState(null);

  // 3D-Agent auth architecture findings
  const authArchitecture = {
    authProvider: "Supabase (mint)",
    apiBase: "https://api.3d-agent.com",
    tokenStorage: "Tauri Stronghold (encrypted)",
    helpers: ["codex-scoped-token", "codex"],
    envVars: [
      "THREEDAGENT_CODEX_AGENT_TOKEN",
      "THREEDAGENT_CLAUDE_AGENT_TOKEN",
      "THREEDAGENT_DEV_SESSION_TOKEN"
    ],
    endpoints: {
      signin: "signin_with_password",
      register: "register_with_password",
      reset: "request_password_reset",
      postSignin: "/auth/post-signin",
      usage: "/v1/usage",
      checkout: "/checkout/upgrade/url"
    },
    subscription: {
      checkEndpoint: "/v1/usage",
      error402: "subscription_required",
      tierField: "tier_ceiling",
      maxStepsField: "max_steps"
    }
  };

  // Provider API key configuration guide
  const providerGuide = [
    {
      name: "OpenAI",
      id: "openai",
      envVar: "OPENAI_API_KEY",
      keyFormat: "sk-...",
      models: ["gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"],
      configPath: "Settings → Providers → OpenAI",
      setup: "1. Go to platform.openai.com/api-keys\n2. Create new secret key\n3. Paste in OpenAI field above\n4. Enable OpenAI provider in Settings"
    },
    {
      name: "Anthropic",
      id: "anthropic",
      envVar: "ANTHROPIC_API_KEY",
      keyFormat: "sk-ant-...",
      models: ["claude-3-5-sonnet-20241022", "claude-3-opus-20240229"],
      configPath: "Settings → Providers → Anthropic",
      setup: "1. Go to console.anthropic.com/api-keys\n2. Create API key\n3. Paste in Anthropic field above\n4. Enable Anthropic provider in Settings"
    },
    {
      name: "Google Gemini",
      id: "google",
      envVar: "GEMINI_API_KEY",
      keyFormat: "AIza...",
      models: ["gemini-pro", "gemini-1.5-pro"],
      configPath: "Settings → Providers → Google",
      setup: "1. Go to aistudio.google.com/apikey\n2. Create API key\n3. Paste in Google field above\n4. Enable Google provider in Settings"
    },
    {
      name: "Mistral",
      id: "mistral",
      envVar: "MISTRAL_API_KEY",
      keyFormat: "...",
      models: ["mistral-large", "mistral-medium"],
      configPath: "Settings → Providers → Mistral",
      setup: "1. Go to console.mistral.ai/api-keys\n2. Create API key\n3. Paste in Mistral field above\n4. Enable Mistral provider in Settings"
    }
  ];

  const copyToClipboard = (text, type) => {
    navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  const testApiKey = async (provider) => {
    const key = apiKeys[provider];
    if (!key) return;
    setTestResult({ provider, status: "testing" });
    // Simulate API test
    setTimeout(() => {
      const isValid = key.length > 10 && !key.includes(" ");
      setTestResult({ provider, status: isValid ? "valid" : "invalid", message: isValid ? "Key format valid" : "Invalid key format" });
    }, 1000);
  };

  const generateBypassScript = () => {
    const script = `#!/bin/bash
# 3D-Agent API Key Bypass Script
# This script configures 3D-Agent to use your own API keys

# Set environment variables for direct provider access
export OPENAI_API_KEY="${apiKeys.openai || 'YOUR_OPENAI_KEY'}"
export ANTHROPIC_API_KEY="${apiKeys.anthropic || 'YOUR_ANTHROPIC_KEY'}"
export GEMINI_API_KEY="${apiKeys.google || 'YOUR_GOOGLE_KEY'}"
export MISTRAL_API_KEY="${apiKeys.mistral || 'YOUR_MISTRAL_KEY'}"

# Optional: Custom endpoint (for OpenAI-compatible APIs)
${customEndpoint ? `export OPENAI_API_BASE="${customEndpoint}"` : '# export OPENAI_API_BASE="https://your-api.com/v1"'}
${customModel ? `export DEFAULT_MODEL="${customModel}"` : '# export DEFAULT_MODEL="gpt-4o"'}

# Disable subscription checks (if applicable)
export THREEDAGENT_SKIP_AUTH_CHECK="1"
export THREEDAGENT_DEV_MODE="1"

echo "API keys configured. Restart 3D-Agent to apply."
`;
    return script;
  };

  const card = "rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 space-y-2";
  const input = "text-xs font-mono px-2.5 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-rose-500";
  const btn = "flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className={`${card}`}>
        <div className="text-[10px] font-mono font-bold uppercase text-rose-500 flex items-center gap-1.5">
          <Unlock className="h-3.5 w-3.5" /> 3D-Agent De-Paywall Toolkit
        </div>
        <div className="text-xs text-zinc-600 dark:text-zinc-300">
          Configure your own API keys to bypass subscription requirements. The app uses Supabase auth with server-side subscription checks.
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden text-xs w-fit">
        {[
          ["auth", "Auth Architecture", Lock],
          ["keys", "API Key Setup", KeyRound],
          ["bypass", "Bypass Script", Code],
          ["config", "Provider Config", Terminal]
        ].map(([id, label, Icon]) => (
          <button key={id} onClick={() => setActiveTab(id)} className={`flex items-center gap-1.5 px-3 py-2 ${activeTab === id ? "bg-rose-500/10 text-rose-500" : "text-zinc-500"}`}>
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {/* Auth Architecture Tab */}
      {activeTab === "auth" && (
        <div className="space-y-3">
          <div className={`${card}`}>
            <div className="text-[10px] font-mono font-bold uppercase text-zinc-400">Authentication System</div>
            <div className="grid grid-cols-2 gap-3 text-[11px] font-mono">
              <div>
                <div className="text-zinc-500">Provider:</div>
                <div className="text-zinc-700 dark:text-zinc-300">{authArchitecture.authProvider}</div>
              </div>
              <div>
                <div className="text-zinc-500">API Base:</div>
                <div className="text-sky-500">{authArchitecture.apiBase}</div>
              </div>
              <div>
                <div className="text-zinc-500">Token Storage:</div>
                <div className="text-zinc-700 dark:text-zinc-300">{authArchitecture.tokenStorage}</div>
              </div>
              <div>
                <div className="text-zinc-500">Helpers:</div>
                <div className="text-zinc-700 dark:text-zinc-300">{authArchitecture.helpers.join(", ")}</div>
              </div>
            </div>
          </div>

          <div className={`${card}`}>
            <div className="text-[10px] font-mono font-bold uppercase text-zinc-400">Environment Variables</div>
            <div className="space-y-1">
              {authArchitecture.envVars.map((v) => (
                <div key={v} className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-sky-500">{v}</span>
                  <button onClick={() => copyToClipboard(v, v)} className="text-[9px] text-rose-500 hover:underline">{copied === v ? "Copied!" : "Copy"}</button>
                </div>
              ))}
            </div>
          </div>

          <div className={`${card}`}>
            <div className="text-[10px] font-mono font-bold uppercase text-zinc-400">Subscription Check Points</div>
            <div className="space-y-1 text-[11px] font-mono">
              <div className="flex items-center gap-2">
                <span className="text-amber-500">•</span>
                <span className="text-zinc-500">Usage endpoint:</span>
                <span className="text-sky-500">{authArchitecture.subscription.checkEndpoint}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-amber-500">•</span>
                <span className="text-zinc-500">Error on no subscription:</span>
                <span className="text-rose-500">{authArchitecture.subscription.error402} (402)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-amber-500">•</span>
                <span className="text-zinc-500">Tier limit field:</span>
                <span className="text-zinc-700 dark:text-zinc-300">{authArchitecture.subscription.tierField}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-amber-500">•</span>
                <span className="text-zinc-500">Max steps field:</span>
                <span className="text-zinc-700 dark:text-zinc-300">{authArchitecture.subscription.maxStepsField}</span>
              </div>
            </div>
          </div>

          <div className={`${card}`}>
            <div className="text-[10px] font-mono font-bold uppercase text-zinc-400">Auth Flow</div>
            <pre className="p-2 rounded bg-zinc-950 border border-zinc-900 text-[10px] font-mono text-zinc-400 overflow-x-auto">{`1. User signs in via Supabase (password or OAuth)
2. Tauri stores tokens in Stronghold (encrypted)
3. App calls /auth/post-signin to create user row
4. Server checks Stripe subscription status
5. /v1/usage returns 402 if no active subscription
6. Agent max_steps limited by tier_ceiling

Bypass: Use your own API keys directly via provider settings`}</pre>
          </div>
        </div>
      )}

      {/* API Key Setup Tab */}
      {activeTab === "keys" && (
        <div className="space-y-3">
          {providerGuide.map((provider) => (
            <div key={provider.id} className={`${card}`}>
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-mono font-bold uppercase text-zinc-400">{provider.name}</div>
                <span className="text-[9px] font-mono text-zinc-500">{provider.envVar}</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  value={apiKeys[provider.id]}
                  onChange={(e) => setApiKeys({ ...apiKeys, [provider.id]: e.target.value })}
                  placeholder={provider.keyFormat}
                  className={`${input} flex-1`}
                />
                <button onClick={() => testApiKey(provider.id)} disabled={!apiKeys[provider.id]} className={btn}>
                  {testResult?.provider === provider.id && testResult.status === "testing" ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                  Test
                </button>
              </div>
              {testResult?.provider === provider.id && testResult.status !== "testing" && (
                <div className={`text-[10px] font-mono ${testResult.status === "valid" ? "text-emerald-500" : "text-rose-500"}`}>
                  {testResult.message}
                </div>
              )}
              <div className="text-[10px] font-mono text-zinc-500 whitespace-pre-line">{provider.setup}</div>
              <div className="text-[9px] font-mono text-zinc-400">Models: {provider.models.join(", ")}</div>
            </div>
          ))}

          <div className={`${card}`}>
            <div className="text-[10px] font-mono font-bold uppercase text-zinc-400">Custom Endpoint (Optional)</div>
            <input
              value={customEndpoint}
              onChange={(e) => setCustomEndpoint(e.target.value)}
              placeholder="https://your-openai-compatible-api.com/v1"
              className={`${input} w-full`}
            />
            <div className="text-[10px] font-mono text-zinc-500">For OpenAI-compatible APIs (Ollama, LM Studio, etc.)</div>
          </div>
        </div>
      )}

      {/* Bypass Script Tab */}
      {activeTab === "bypass" && (
        <div className="space-y-3">
          <div className={`${card}`}>
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-mono font-bold uppercase text-zinc-400">Environment Variable Bypass Script</div>
              <button onClick={() => copyToClipboard(generateBypassScript(), "script")} className="text-[9px] font-mono text-rose-500 hover:underline">
                {copied === "script" ? "Copied!" : "Copy script"}
              </button>
            </div>
            <pre className="p-3 rounded-lg bg-zinc-950 border border-zinc-900 text-[10px] font-mono text-zinc-300 overflow-x-auto max-h-64 leading-normal">
              {generateBypassScript()}
            </pre>
          </div>

          <div className={`${card}`}>
            <div className="text-[10px] font-mono font-bold uppercase text-zinc-400">Quick Commands</div>
            <div className="space-y-1.5">
              {[
                { cmd: "export OPENAI_API_KEY=sk-...", desc: "Set OpenAI key for direct access" },
                { cmd: "export ANTHROPIC_API_KEY=sk-ant-...", desc: "Set Anthropic key for direct access" },
                { cmd: "open -a 3D-Agent", desc: "Restart app with new env vars" },
                { cmd: "defaults delete com.3d-agent.app", desc: "Reset app preferences" }
              ].map((item, i) => (
                <div key={i} className="flex items-center justify-between text-[11px] font-mono">
                  <div>
                    <span className="text-sky-500">{item.cmd}</span>
                    <span className="text-zinc-500 ml-2"># {item.desc}</span>
                  </div>
                  <button onClick={() => copyToClipboard(item.cmd, `cmd${i}`)} className="text-[9px] text-rose-500 hover:underline">{copied === `cmd${i}` ? "Copied!" : "Copy"}</button>
                </div>
              ))}
            </div>
          </div>

          <div className={`${card}`}>
            <div className="text-[10px] font-mono font-bold uppercase text-zinc-400">How It Works</div>
            <pre className="p-2 rounded bg-zinc-950 border border-zinc-900 text-[10px] font-mono text-zinc-400 overflow-x-auto">{`The app's provider system already supports user-provided API keys:
1. Settings → Providers → Select provider
2. Enter your API key
3. Enable the provider
4. Select model from that provider

The paywall is enforced server-side via Supabase auth + Stripe.
Direct API keys bypass the backend proxy entirely.`}</pre>
          </div>
        </div>
      )}

      {/* Provider Config Tab */}
      {activeTab === "config" && (
        <div className="space-y-3">
          <div className={`${card}`}>
            <div className="text-[10px] font-mono font-bold uppercase text-zinc-400">Provider Registration Flow</div>
            <pre className="p-2 rounded bg-zinc-950 border border-zinc-900 text-[10px] font-mono text-zinc-400 overflow-x-auto">{`// From extracted source code:
export function providerRemoteApiKeyChain(provider) {
  const primary = provider.api_key?.trim()
  const fallbacks = (provider.api_key_fallbacks ?? [])
    .map((k) => String(k).trim())
    .filter((k) => k.length > 0)
  const ordered = [...(primary ? [primary] : []), ...fallbacks]
  const seen = new Set<string>()
  return ordered.filter((k) => {
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// The app registers providers with the Tauri backend:
await invoke('register_provider_config', { request: {
  provider: 'openai',
  api_key: chain[0],
  api_keys: chain.slice(1),
  base_url: provider.base_url,
  models: provider.models.map(e => e.id)
}})`}</pre>
          </div>

          <div className={`${card}`}>
            <div className="text-[10px] font-mono font-bold uppercase text-zinc-400">Tauri IPC Commands</div>
            <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
              {[
                "register_provider_config",
                "unregister_provider_config",
                "get_provider_config",
                "list_provider_configs",
                "get_tools",
                "call_tool",
                "get_mcp_configs",
                "restart_mcp_servers"
              ].map((cmd) => (
                <div key={cmd} className="text-sky-500">{cmd}</div>
              ))}
            </div>
          </div>

          <div className={`${card}`}>
            <div className="text-[10px] font-mono font-bold uppercase text-zinc-400">Codex Agent Integration</div>
            <pre className="p-2 rounded bg-zinc-950 border border-zinc-900 text-[10px] font-mono text-zinc-400 overflow-x-auto">{`// Codex Agent is embedded as a helper binary:
resources/bin/codex
resources/bin/codex-scoped-token

// Environment variables for Codex:
THREEDAGENT_CODEX_AGENT_TOKEN
THREEDAGENT_CODEX_APP_SERVER
THREEDAGENT_CODEX_RESPONSES_WEBSOCKETS
THREEDAGENT_CODEX_REASONING_SUMMARY

// The scoped token listener manages auth:
codex-scoped-token-listener
  → helper_connection_rejected
  → unix_accept_failed
  → listener_start_rejected`}</pre>
          </div>

          <div className={`${card}`}>
            <div className="text-[10px] font-mono font-bold uppercase text-zinc-400">Local API Server Mode</div>
            <pre className="p-2 rounded bg-zinc-950 border border-zinc-900 text-[10px] font-mono text-zinc-400 overflow-x-auto">{`// The app can run as a local API server:
local_server_port: 1337
bind_fallback: 127.0.0.1:0

// This allows other tools to use it as a proxy:
curl http://127.0.0.1:1337/v1/chat/completions \\
  -H "Authorization: Bearer YOUR_KEY" \\
  -d '{"model": "gpt-4o", "messages": [...]}'`}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CyberTab() {
  const managedCredentials = cloudAuthEnabled();
  const [view, setView] = useState("surface");
  const [projectId, setProjectId] = useState(() => activeProject());
  const [token, setToken] = useState("");
  const [stored, setStored] = useState(false);
  const [credentialNote, setCredentialNote] = useState(null);
  const purpose = projectId ? `cyber/sentinel/${projectId}/access-token` : null;
  React.useEffect(() => onActiveProject(setProjectId), []);
  React.useEffect(() => {
    let current = true;
    setToken("");
    if (managedCredentials && projectId) {
      void credentialStatus("sentinel").then((status) => { if (current) { setStored(status.configured); setToken(status.configured ? "brokered" : ""); } }).catch((error) => { if (current) setCredentialNote({ ok: false, msg: String(error.message || error) }); });
    } else {
      setStored(purpose ? hasSecret(purpose) : false);
      if (purpose) void getSecret(purpose).then((value) => { if (current && value) setToken(String(value)); });
    }
    return () => { current = false; };
  }, [purpose, projectId, managedCredentials]);

  const storeToken = async (value) => {
    const clean = String(value || "").trim();
    if (!purpose || clean.length < 20 || /\s/.test(clean)) {
      const result = { ok: false, error: "Select a project and enter a valid service-issued bearer token." };
      setCredentialNote({ ok: false, msg: result.error });
      return result;
    }
    const result = managedCredentials ? await storeServiceToken("sentinel", clean).then(() => ({ ok: true })).catch((error) => ({ ok: false, error: String(error.message || error) })) : await putSecret(purpose, clean);
    if (!result.ok) { setCredentialNote({ ok: false, msg: result.error }); return result; }
    setToken(managedCredentials ? "brokered" : clean); setStored(true); setCredentialNote({ ok: true, msg: managedCredentials ? "Sentinel token encrypted server-side with KMS for this user and project." : "Sentinel token encrypted for this user and project." });
    return result;
  };
  const removeToken = async () => {
    if (managedCredentials && projectId) await removeServiceToken("sentinel");
    else if (purpose) await deleteSecret(purpose);
    setToken(""); setStored(false); setCredentialNote({ ok: true, msg: "Project token removed." });
  };
  const views = [["surface", "Attack Surface", Radar], ["threat", "Threat Model", ShieldAlert], ["strix", "Strix AI Pentest", ShieldCheck], ["re", "Reverse Engineering", Binary], ["deob", "Deobfuscator", Wand2], ["depw", "De-Paywall", Unlock], ["api", "Sentinel API", Server]];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ShieldHalf className="h-6 w-6 text-rose-500" /> Cyber Engine
        </h1>
      </div>
      <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden text-xs w-fit">
        {views.map(([id, label, Icon]) => (
          <button key={id} onClick={() => setView(id)} className={`flex items-center gap-1.5 px-3 py-2 ${view === id ? "bg-rose-500/10 text-rose-500" : "text-zinc-500"}`}><Icon className="h-3.5 w-3.5" /> {label}</button>
        ))}
      </div>
      {view === "surface" && <AttackSurface projectId={projectId} token={token} />}
      {view === "threat" && <ThreatModel />}
      {view === "strix" && <StrixPentest projectId={projectId} token={token} />}
      {view === "re" && <BinaryAnalysis />}
      {view === "deob" && <Deobfuscator />}
      {view === "depw" && <DePaywall />}
      {view === "api" && <SentinelAPI projectId={projectId} token={token} stored={stored} onStoreToken={storeToken} onRemoveToken={removeToken} credentialNote={credentialNote} />}
    </div>
  );
}
