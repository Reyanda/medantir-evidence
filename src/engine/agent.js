// agent.js — The Composer agent: an AI that can answer real-world questions AND
// call the platform's real tools (query the ontology, run EWAR monitors, rank
// actions, search the power network, read media sentiment, invoke registered
// modules). This is the seed of closed-loop operation: prompt → reason → call
// tools → observe → answer/act.
//
// Uses OpenAI-style function calling against the active tool-capable provider
// (OpenRouter/DeepSeek/etc). Every tool is a real engine function — not a stub.

import { engine, api } from "./index.js";
import { activeToolProvider, callOpenAIRaw } from "./providers.js";
import { runMonitor, MONITORS } from "./monitors.js";
import { currentLocation, loadSession, availableEngines } from "./session.js";
import { MODULES, callModule } from "./modules.js";
import { searchSkills, getSkill, SKILL_COUNT } from "./skills.js";
import { mcpAllTools, mcpCallTool } from "./mcp.js";
import { activeProject, listFiles as psListFiles, getFile as psGetFile, putFile as psPutFile, retrieve as psRetrieve } from "./projectstore.js";
import { executeAppAction } from "./appOperator.js";
import { navigate as browserNavigate, snapshot as browserSnapshot, clickEl as browserClick, fillEl as browserFill } from "./browserBridge.js";
import { NAVIGATION_SURFACES } from "./navigation.js";
import { DESIGN_LANGUAGES, UI_THEMES, PALETTES, BACKGROUNDS, APPEARANCES, TYPOGRAPHIES, MOTIONS } from "./designSystem.js";
import { requestBrowserUrl } from "./browserBus.js";
import { buildMultimodalUserContent, isImageAttachment, providerCanSeeImages } from "./promptAttachments.js";
import { runWorkspaceCommand, readCodebaseFile, writeCodebaseFile, runHostCommand } from "./projectRuntime.js";
import { cloudAuthEnabled, cloudCurrentUser } from "./cloudAuth.js";
import { filterToolsForMode, resolveProjectMode } from "./operatingModes.js";
import { parseModelJson } from "./modelJson.js";

// Host self-modification is a SUDO-only capability. The runtime enforces this
// server-side (Cognito operator group); here we keep the tools out of the
// model's reach entirely for non-sudo users — defence in depth.
const SELF_IMPROVE_TOOLS = new Set(["self_improve_read_file", "self_improve_write_file", "self_improve_run_command"]);

export function currentUserIsSudo() {
  if (cloudAuthEnabled()) return cloudCurrentUser()?.role === "sudo";
  try {
    return JSON.parse(localStorage.getItem("medantir.currentUser.v1") || "null")?.role === "sudo";
  } catch {
    return false;
  }
}

// Resolve the tool subset for one agent turn: harness/mode filter first, then
// the sudo gate on self-improvement. Exported for tests.
export function allowedToolSet(toolFilter, { sudo = currentUserIsSudo() } = {}) {
  const names = Array.isArray(toolFilter) ? toolFilter : Object.keys(TOOLS);
  const visible = new Set(names.filter((name) => sudo || !SELF_IMPROVE_TOOLS.has(name)));
  return Object.fromEntries(Object.entries(TOOLS).filter(([name]) => visible.has(name)));
}

// Composer tool policy: the project's operating mode strips denied tools
// (e.g. module/MCP calls outside security mode) from the full registry.
export function toolFilterForProject(project) {
  return filterToolsForMode(resolveProjectMode(project), Object.keys(TOOLS));
}

// --- tool registry: name → { schema (OpenAI tool def), run(args) } ----------
const TOOLS = {
  app_navigate: {
    def: { type: "function", function: { name: "app_navigate", description: "Navigate Actiora to a named internal surface. Use this instead of clicking Actiora UI elements.", parameters: { type: "object", properties: { surface: { type: "string", enum: NAVIGATION_SURFACES.map((item) => item.id) } }, required: ["surface"] } } },
    run: ({ surface }) => executeAppAction("navigate", { surface }),
  },
  app_set_design: {
    def: { type: "function", function: { name: "app_set_design", description: "Change reversible Actiora visual-language preferences.", parameters: { type: "object", properties: {
      language: { type: "string", enum: DESIGN_LANGUAGES.map((item) => item.id) }, theme: { type: "string", enum: UI_THEMES.map((item) => item.id) }, palette: { type: "string", enum: PALETTES.map((item) => item.id) }, background: { type: "string", enum: BACKGROUNDS.map((item) => item.id) }, appearance: { type: "string", enum: APPEARANCES.map((item) => item.id) }, typography: { type: "string", enum: TYPOGRAPHIES.map((item) => item.id) }, motion: { type: "string", enum: MOTIONS.map((item) => item.id) },
    } } } },
    run: (patch) => executeAppAction("design", { patch }),
  },
  app_open_tool: {
    def: { type: "function", function: { name: "app_open_tool", description: "Open a persistent right-hand workspace tool.", parameters: { type: "object", properties: { tab: { type: "string", enum: ["browser", "terminal", "git", "agents", "plots", "office"] } }, required: ["tab"] } } },
    run: ({ tab }) => executeAppAction("pane", { tab }),
  },
  set_reminder: {
    def: { type: "function", function: { name: "set_reminder", description: "Create a personal reminder shown by the Actiora companion. Use an ISO-8601 date/time with timezone.", parameters: { type: "object", properties: { title: { type: "string" }, when: { type: "string" } }, required: ["title", "when"] } } },
    run: (args) => executeAppAction("reminder", args),
  },
  browser_navigate: {
    def: { type: "function", function: { name: "browser_navigate", description: "Navigate the user's isolated Actiora browser session to an HTTP(S) URL.", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } } },
    run: async ({ url }) => {
      let target;
      try { target = new URL(url); } catch { return { ok: false, error: "Invalid URL." }; }
      if (!["http:", "https:"].includes(target.protocol)) return { ok: false, error: "Only HTTP(S) URLs are allowed." };
      await executeAppAction("pane", { tab: "browser" });
      requestBrowserUrl(target.href);
      return browserNavigate(target.href, false, "Actiora Operator");
    },
  },
  browser_snapshot: {
    def: { type: "function", function: { name: "browser_snapshot", description: "Read the current browser page accessibility snapshot before deciding what to click.", parameters: { type: "object", properties: {} } } },
    run: async () => browserSnapshot(),
  },
  browser_click: {
    def: { type: "function", function: { name: "browser_click", description: "Click a non-consequential page element by CSS selector after browser_snapshot. Never submit, send, purchase, delete, or change account/security settings.", parameters: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] } } },
    run: async ({ selector }) => typeof selector === "string" && selector.trim() && selector.length <= 300 ? browserClick(selector.trim()) : { ok: false, error: "Invalid selector." },
  },
  browser_fill: {
    def: { type: "function", function: { name: "browser_fill", description: "Fill ordinary non-secret text into a browser field after browser_snapshot. Never enter passwords, tokens, payment, health, or other sensitive data.", parameters: { type: "object", properties: { selector: { type: "string" }, value: { type: "string" } }, required: ["selector", "value"] } } },
    run: async ({ selector, value }) => typeof selector === "string" && selector.trim() && selector.length <= 300 && typeof value === "string" && value.length <= 2000 ? browserFill(selector.trim(), value) : { ok: false, error: "Invalid browser input." },
  },
  query_ontology: {
    def: {
      type: "function",
      function: {
        name: "query_ontology",
        description: "Query the platform ontology. Returns object counts, or objects of a given kind (Claim, Source, ThreatDomain, PowerNode, MediaSignal, Region, Alert).",
        parameters: {
          type: "object",
          properties: {
            kind: { type: "string", description: "Object kind, or omit for all counts" },
            limit: { type: "number", description: "max objects to return (default 8)" },
          },
        },
      },
    },
    run: ({ kind, limit = 8 }) => {
      if (!kind) return { counts: engine.counts() };
      return { kind, objects: engine.all(kind).slice(0, limit).map((o) => ({ id: o.id, ...o, _prov: undefined })) };
    },
  },

  recommend_actions: {
    def: {
      type: "function",
      function: {
        name: "recommend_actions",
        description: "Return the decision engine's current highest-expected-value actions across the whole board.",
        parameters: { type: "object", properties: { limit: { type: "number" } } },
      },
    },
    run: ({ limit = 5 }) => ({ actions: api.recommendGlobal({ limit }) }),
  },

  run_monitor: {
    def: {
      type: "function",
      function: {
        name: "run_monitor",
        description: `Run an EWAR monitor for the current scope and return its risk assessment with uncertainty. Monitors: ${Object.keys(MONITORS).join(", ")}.`,
        parameters: {
          type: "object",
          properties: { monitor: { type: "string", enum: Object.keys(MONITORS) } },
          required: ["monitor"],
        },
      },
    },
    run: async ({ monitor }) => {
      const r = await runMonitor(monitor, currentLocation());
      return {
        monitor,
        scope: currentLocation().name,
        level: r.assessment?.level,
        riskIndex: r.assessment?.consensus,
        band: r.assessment?.band,
        modelUncertainty: r.assessment?.modelUncertainty,
        algorithms: r.assessment?.results?.map((x) => ({ name: x.name, estimate: x.estimate })),
        drivers: (r.drivers || []).slice(0, 4).map((d) => d.title),
        sources: r.sources,
      };
    },
  },

  threat_sentiment: {
    def: {
      type: "function",
      function: {
        name: "threat_sentiment",
        description: "Return current media-sentiment indices per global-security threat domain.",
        parameters: { type: "object", properties: {} },
      },
    },
    run: () => ({
      domains: engine.all("ThreatDomain").map((d) => ({ domain: d.slug, index: d.sentimentIndex, level: d.threatLevel, signals: d.signalCount })),
    }),
  },

  search_power_network: {
    def: {
      type: "function",
      function: {
        name: "search_power_network",
        description: "Search the merged power/ownership network (MapIt) by entity or country name.",
        parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
      },
    },
    run: ({ q }) => ({
      matches: engine
        .all("PowerNode")
        .filter((n) => (n.name || "").toLowerCase().includes((q || "").toLowerCase()) || (n.country || "").toLowerCase().includes((q || "").toLowerCase()))
        .sort((a, b) => (b.influence || 0) - (a.influence || 0))
        .slice(0, 6)
        .map((n) => ({
          name: n.name,
          type: n.entityType,
          country: n.country,
          influence: n.influence,
          // who holds a stake in this entity (answers "who owns X")
          ownedBy: engine.linkedInverse(n.id, "owns").map((o) => o.name),
          // what this entity holds stakes in
          ownsStakeIn: engine.linked(n.id, "owns").map((o) => o.name),
        })),
    }),
  },

  list_modules: {
    def: {
      type: "function",
      function: {
        name: "list_modules",
        description: "List the registered software modules (the merged app portfolio) and their capabilities.",
        parameters: { type: "object", properties: {} },
      },
    },
    run: () => ({ modules: MODULES.map((m) => ({ id: m.id, name: m.name, domain: m.domain, capabilities: m.capabilities, hasApi: !!m.api })) }),
  },

  call_module: {
    def: {
      type: "function",
      function: {
        name: "call_module",
        description: "Invoke a registered module's API endpoint (if it exposes one). Use list_modules first.",
        parameters: {
          type: "object",
          properties: { id: { type: "string" }, path: { type: "string" } },
          required: ["id"],
        },
      },
    },
    run: async ({ id, path }) => callModule(id, path),
  },

  find_skill: {
    def: {
      type: "function",
      function: {
        name: "find_skill",
        description: `Search the operator's skill catalogue (${SKILL_COUNT} skills) for capabilities matching a task. Returns matching skill names + descriptions.`,
        parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      },
    },
    run: ({ query }) => ({ skills: searchSkills(query, 10) }),
  },

  use_skill: {
    def: {
      type: "function",
      function: {
        name: "use_skill",
        description: "Load a named skill's guidance so you can apply its method to the current task.",
        parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      },
    },
    run: ({ name }) => {
      const s = getSkill(name);
      return s ? { skill: s.name, guidance: s.description } : { error: `no skill named ${name}` };
    },
  },

  browse_files: {
    def: {
      type: "function",
      function: {
        name: "browse_files",
        description: "List the file tree of a project/repo (GitHub, e.g. 'Reyanda/InferenceOS'). Returns file paths so you can navigate a codebase.",
        parameters: { type: "object", properties: { repo: { type: "string" }, filter: { type: "string", description: "optional path substring filter" } }, required: ["repo"] },
      },
    },
    run: async ({ repo, filter }) => {
      const slug = repo.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
      try {
        const res = await fetch(`https://api.github.com/repos/${slug}/git/trees/HEAD?recursive=1`);
        if (!res.ok) return { error: `GitHub ${res.status} for ${slug}` };
        const d = await res.json();
        let paths = (d.tree || []).filter((t) => t.type === "blob").map((t) => t.path);
        if (filter) paths = paths.filter((p) => p.includes(filter));
        return { repo: slug, files: paths.slice(0, 120), total: paths.length };
      } catch (e) {
        return { error: String(e.message || e) };
      }
    },
  },

  read_file: {
    def: {
      type: "function",
      function: {
        name: "read_file",
        description: "Read a file from a GitHub repo (use browse_files first). Returns the file contents.",
        parameters: { type: "object", properties: { repo: { type: "string" }, path: { type: "string" } }, required: ["repo", "path"] },
      },
    },
    run: async ({ repo, path }) => {
      const slug = repo.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
      try {
        const res = await fetch(`https://raw.githubusercontent.com/${slug}/HEAD/${path}`);
        if (!res.ok) return { error: `raw ${res.status}` };
        return { repo: slug, path, content: (await res.text()).slice(0, 6000) };
      } catch (e) {
        return { error: String(e.message || e) };
      }
    },
  },

  // --- Workspace project tools: the harness WORKS ON the active project ------
  project_files: {
    def: {
      type: "function",
      function: {
        name: "project_files",
        description: "List the files in the active Workspace project. Use before reading/writing to see what exists.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    run: async () => {
      const pid = activeProject();
      if (!pid) return { error: "No active project. The user must select a project first." };
      return { project: pid, files: psListFiles(pid).map((f) => f.path) };
    },
  },

  project_read: {
    def: {
      type: "function",
      function: {
        name: "project_read",
        description: "Read a file's contents from the active Workspace project.",
        parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      },
    },
    run: async ({ path }) => {
      const pid = activeProject();
      if (!pid) return { error: "No active project." };
      const f = psGetFile(pid, path);
      return f ? { path, content: (f.content || "").slice(0, 8000) } : { error: `no file ${path}` };
    },
  },

  project_write: {
    def: {
      type: "function",
      function: {
        name: "project_write",
        description: "Write (create or overwrite) a file in the active Workspace project. Use this to save extractions, results, code, or reports so work persists.",
        parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
      },
    },
    run: async ({ path, content }) => {
      const pid = activeProject();
      if (!pid) return { error: "No active project." };
      const f = psPutFile(pid, { path, name: path.split("/").pop(), content: content || "" });
      return f ? { ok: true, path: f.path, bytes: (f.content || "").length } : { error: "write failed" };
    },
  },

  project_retrieve: {
    def: {
      type: "function",
      function: {
        name: "project_retrieve",
        description: "Retrieve the most relevant slices of the active project's corpus for a query (context management — pull only what you need).",
        parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      },
    },
    run: async ({ query }) => {
      const pid = activeProject();
      if (!pid) return { error: "No active project." };
      return { hits: psRetrieve(pid, query, 5) };
    },
  },

  web_fetch: {
    def: {
      type: "function",
      function: {
        name: "web_fetch",
        description: "Fetch a web URL and return its text (open-source browser layer). Use for live research; some sites block cross-origin — then use the in-app Browser or kimi-webbridge.",
        parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
      },
    },
    run: async ({ url }) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return { error: `${res.status}` };
        const text = (await res.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        return { url, text: text.slice(0, 5000) };
      } catch (e) {
        return { error: `${String(e.message || e)} (likely CORS — use in-app Browser/kimi)` };
      }
    },
  },

  mcp_tool: {
    def: {
      type: "function",
      function: {
        name: "mcp_tool",
        description: "List available MCP tools (omit name) or call one on a connected MCP server.",
        parameters: {
          type: "object",
          properties: { server: { type: "string" }, name: { type: "string" }, args: { type: "object" } },
        },
      },
    },
    run: async ({ server, name, args }) => {
      if (!name) return { tools: await mcpAllTools() };
      return mcpCallTool(server, name, args);
    },
  },

  run_workspace_command: {
    def: {
      type: "function",
      function: {
        name: "run_workspace_command",
        description: "Run a bash shell command (e.g. R, Python, C++, etc.) inside the project's isolated container workspace and return stdout, stderr, and exitCode. Useful for executing data science pipelines.",
        parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
      },
    },
    run: async ({ command }) => {
      const pid = activeProject();
      if (!pid) return { error: "No active project." };
      try {
        return await runWorkspaceCommand(pid, command);
      } catch (e) {
        return { error: String(e.message || e) };
      }
    },
  },

  self_improve_read_file: {
    def: {
      type: "function",
      function: {
        name: "self_improve_read_file",
        description: "Read any source code file of the Medantir application codebase from the host deployment for analysis and self-improvement.",
        parameters: { type: "object", properties: { path: { type: "string", description: "Relative path to file in repository (e.g. 'src/App.jsx')" } }, required: ["path"] },
      },
    },
    run: async ({ path }) => {
      if (!currentUserIsSudo()) return { error: "Self-improvement requires the SUDO operator role." };
      const pid = activeProject();
      if (!pid) return { error: "No active project." };
      try {
        return await readCodebaseFile(pid, path);
      } catch (e) {
        return { error: String(e.message || e) };
      }
    },
  },

  self_improve_write_file: {
    def: {
      type: "function",
      function: {
        name: "self_improve_write_file",
        description: "Write or modify any source code file of the Medantir application codebase on the host deployment for self-improvement.",
        parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
      },
    },
    run: async ({ path, content }) => {
      if (!currentUserIsSudo()) return { error: "Self-improvement requires the SUDO operator role." };
      const pid = activeProject();
      if (!pid) return { error: "No active project." };
      try {
        return await writeCodebaseFile(pid, path, content);
      } catch (e) {
        return { error: String(e.message || e) };
      }
    },
  },

  self_improve_run_command: {
    def: {
      type: "function",
      function: {
        name: "self_improve_run_command",
        description: "Execute a build, test, compilation, or deployment command in the codebase directory on the host (e.g. 'npm run build', 'scripts/deploy-all.sh', etc.) to apply and test self-improvement modifications.",
        parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
      },
    },
    run: async ({ command }) => {
      if (!currentUserIsSudo()) return { error: "Self-improvement requires the SUDO operator role." };
      const pid = activeProject();
      if (!pid) return { error: "No active project." };
      try {
        return await runHostCommand(pid, command);
      } catch (e) {
        return { error: String(e.message || e) };
      }
    },
  },
};

// --- system prompt: platform identity + live context ----------------------
function systemPrompt() {
  const s = loadSession();
  const loc = currentLocation();
  return (
    `You are the Actiora Operator — the single agentic core of the Medantir global intelligence platform ` +
    `(health, defence, climate, energy, economy, cyber, food, migration; media sentiment; ` +
    `a decision engine; EWAR monitors; a merged power/ownership network; and a registry of the ` +
    `operator's software modules). You answer real-world questions and control the app and its isolated browser. CALL TOOLS ` +
    `to ground answers in live platform data before responding.\n\n` +
    `Operator: ${s.name}, clearance L${s.clearance}, scope ${loc.name}. ` +
    `Engines available: ${availableEngines().map((e) => e.id).join(", ")}.\n` +
    `You can run bash commands (Python, R, compilers, etc.) in the isolated workspace container using run_workspace_command.\n` +
    (currentUserIsSudo()
      ? `You have complete self-improvement capacity: you can read, modify, and build/deploy your own codebase using self_improve_read_file, self_improve_write_file, and self_improve_run_command to implement requested changes, run tests, and redeploy Medantir dynamically.\n`
      : "") +
    `You can navigate codebases with browse_files/read_file, fetch the live web with web_fetch, ` +
    `and reach external systems via mcp_tool (Notion/GitHub/Gmail/Slack/… when enabled).\n` +
    `Use app_navigate/app_set_design/app_open_tool for Actiora itself; never simulate DOM clicks inside Actiora. ` +
    `When the user asks you to create, author, revise, export, or preserve an artifact, use project_files/project_read as needed and project_write to save the complete result in the active project; do not merely paste a draft into chat. ` +
    `For websites, navigate then inspect browser_snapshot before browser_click/browser_fill. Automatically perform reversible navigation and preference actions. ` +
    `Never send, publish, purchase, delete, change credentials/security, or execute another consequential action without explicit user confirmation. ` +
    `You operate as a LOOP: gather with tools → reason → act → observe → repeat until the task is done. ` +
    `For heavy multi-step WORKFLOWS, decompose into ordered steps and, when available, delegate to the ` +
    `inferno-code module via call_module (agentic task decomposition + execution).\n` +
    `You are SKILL-FLUENT: ${SKILL_COUNT} specialist skills are available (systematic review, causal ` +
    `inference, evidence synthesis, security, document/figure production, deployment, and more). Call ` +
    `find_skill(query) to recall the right one for a task, then use_skill(name) to load its method. You ` +
    `can also call MCP tools via mcp_tool.\n` +
    `Be terse and decision-useful. Prefer tool-grounded facts over speculation. When a monitor, skill, or ` +
    `the ontology can answer, call it. ANSWER DIRECTLY from tool results — if a tool returns the data ` +
    `(e.g. ownedBy for a power-network entity), state the answer plainly; do NOT offer to escalate or ` +
    `"check other sources" when the answer is already in hand. Only escalate when a tool genuinely ` +
    `returns nothing. Cite which tools/skills you used. Never fabricate data.`
  );
}

// --- agent loop -----------------------------------------------------------
// Runs the model, executes any tool calls, feeds results back, repeats up to
// maxSteps, then returns the final answer + a trace of tools invoked.
export async function runAgent(userMessage, { history = [], attachments = [], onStep, maxSteps = 8, system, toolFilter } = {}) {
  const provider = activeToolProvider();
  if (!provider) return { ok: false, reason: "Enable a tool-capable provider (OpenRouter/DeepSeek/OpenAI/…) in AI Providers.", trace: [] };
  if (attachments.some(isImageAttachment) && !providerCanSeeImages(provider)) {
    return { ok: false, reason: `${provider.label} model ${provider.model || provider.defaultModel} is text-only. Select a vision-capable model to analyse image attachments.`, trace: [] };
  }

  const messages = [
    { role: "system", content: system ? `${systemPrompt()}\n\n${system}` : systemPrompt() },
    ...history,
    { role: "user", content: buildMultimodalUserContent(userMessage, attachments) },
  ];
  // Harness/mode scoping + the sudo gate on self-improvement.
  const allowed = allowedToolSet(toolFilter);
  const toolDefs = Object.values(allowed).map((t) => t.def);
  const trace = [];

  for (let step = 0; step < maxSteps; step++) {
    let resp;
    try {
      resp = await callOpenAIRaw(provider.id, { messages, tools: toolDefs });
    } catch (e) {
      return { ok: false, reason: String(e.message || e), trace };
    }
    const msg = resp.choices?.[0]?.message;
    if (!msg) return { ok: false, reason: "Empty model response", trace };
    messages.push(msg);

    const calls = msg.tool_calls || [];
    if (!calls.length) {
      return { ok: true, answer: msg.content || "", trace, provider: provider.label };
    }

    // execute each requested tool call and feed results back
    for (const call of calls) {
      const name = call.function?.name;
      let args = {};
      try {
        args = JSON.parse(call.function?.arguments || "{}");
      } catch {
        /* ignore bad args */
      }
      const tool = allowed[name];
      let result;
      try {
        result = tool ? await tool.run(args) : { error: `unknown tool ${name}` };
      } catch (e) {
        result = { error: String(e.message || e) };
      }
      trace.push({ tool: name, args, result });
      onStep?.({ tool: name, args, result });
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 4000) });
    }
  }
  try {
    const final = await callOpenAIRaw(provider.id, { messages: [...messages, { role: "system", content: "The tool-call budget is exhausted. Give the user the best complete answer from the gathered results now. State any genuinely unfinished work briefly; do not request more tools." }] });
    const answer = final.choices?.[0]?.message?.content;
    if (answer) return { ok: true, answer, trace, provider: provider.label, toolBudgetExhausted: true };
  } catch {
    /* retain the completed trace below when the final synthesis request fails */
  }
  return { ok: true, answer: "Tool work paused at the safe execution limit. The completed actions are preserved above; send ‘continue’ to resume from this project transcript.", trace, provider: provider.label, toolBudgetExhausted: true };
}

export function agentTools() {
  return Object.keys(TOOLS);
}

// LLM-driven recommendations: the agent gathers REAL data via tools (sentiment,
// monitors, power network) and returns a prioritised, structured action list.
// This replaces the fixed expected-value list with genuine situational analysis.
export async function recommendDecisions() {
  if (!activeToolProvider()) return { ok: false, reason: "Enable a tool-capable provider (OpenRouter/DeepSeek/…) in AI Providers." };
  const res = await runAgent(
    "Act as the command decision engine. FIRST gather real data: call threat_sentiment, then run_monitor for the 2-3 most alarming domains, and recommend_actions for board context. THEN output ONLY a JSON array (no prose) of the 5 highest-priority recommended actions, each: " +
      '{"title": short imperative action, "domain": one of health/defence/climate/energy/economy/cyber/food/migration, "rationale": one sentence grounded in the tool data, "priority": "critical"|"high"|"medium", "confidence": number 0-1}.',
    { maxSteps: 7 }
  );
  if (!res.ok) return res;
  const parsed = parseModelJson(res.answer, { array: true, itemFields: { title: "string", rationale: "string" } });
  if (!parsed.ok || !parsed.value.length) return { ok: true, recommendations: [], raw: res.answer, trace: res.trace, provider: res.provider };
  return { ok: true, recommendations: parsed.value, trace: res.trace, provider: res.provider };
}
