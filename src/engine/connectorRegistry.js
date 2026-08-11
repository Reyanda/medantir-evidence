import { MCP_CATALOG } from "./mcp.js";

const HOME_BY_ID = {
  notion: ["Knowledge", "Project Integrations and Files"],
  github: ["Development", "Project Integrations and Git"],
  linear: ["Work management", "Project Integrations"],
  atlassian: ["Work management", "Project Integrations"],
  asana: ["Work management", "Project Integrations"],
  sentry: ["Development", "Project Integrations and Browser"],
  stripe: ["Finance", "Project Integrations"],
  cloudflare: ["Development", "Project Integrations and Browser"],
};

export const NATIVE_CONNECTORS = [
  {
    id: "obsidian",
    name: "Obsidian vault",
    kind: "native",
    domain: "Knowledge",
    home: "Project Files, Workbench, Search, and Terminal",
    state: "native",
    note: "An Obsidian vault is an authorized local folder of Markdown and related files. Attach the vault directory to the project; no cloud API is claimed.",
  },
];

export function connectorRegistry() {
  return [
    ...MCP_CATALOG.map((server) => {
      const [domain, home] = HOME_BY_ID[server.id] || ["Other", "Project Integrations"];
      return { ...server, kind: "mcp", domain, home };
    }),
    ...NATIVE_CONNECTORS,
  ];
}

export function connectorHome(id) {
  return connectorRegistry().find((connector) => connector.id === id) || null;
}

const READ_PREFIX = /^(list|get|read|search|find|query|fetch|inspect|view|lookup)(_|\b)/i;

export function isReadLikeTool(name) {
  return READ_PREFIX.test(String(name || ""));
}

export function defaultToolArguments(tool) {
  const properties = tool?.inputSchema?.properties || {};
  const required = new Set(tool?.inputSchema?.required || []);
  const args = {};
  for (const [key, schema] of Object.entries(properties)) {
    if (!required.has(key) && schema.default === undefined) continue;
    if (schema.default !== undefined) args[key] = schema.default;
    else if (schema.type === "boolean") args[key] = false;
    else if (schema.type === "number" || schema.type === "integer") args[key] = 0;
    else if (schema.type === "array") args[key] = [];
    else if (schema.type === "object") args[key] = {};
    else args[key] = "";
  }
  return args;
}

export function connectorResultPath(connectorId, toolName, at = Date.now()) {
  const safe = (value) => String(value || "result").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "result";
  return `integrations/${safe(connectorId)}/${new Date(at).toISOString().replace(/[:.]/g, "-")}-${safe(toolName)}.json`;
}
