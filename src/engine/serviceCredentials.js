import { activeProject } from "./projectstore.js";
import { cloudAuthEnabled, cloudAuthHeaders } from "./cloudAuth.js";

// The runtime is path-routed under the API gateway (Caddy `handle_path /runtime/*`
// strips the prefix); runtime.actiora.com is not a served origin.
const RUNTIME_API = "https://api.actiora.com/runtime";
async function request(service, options = {}) {
  const projectId = activeProject();
  if (!cloudAuthEnabled()) throw new Error("Managed credential broker is available on the signed-in cloud platform.");
  const headers = await cloudAuthHeaders(projectId, options.headers || {});
  const response = await fetch(`${RUNTIME_API}/v1/credentials/${encodeURIComponent(service)}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Credential broker HTTP ${response.status}`);
  return body;
}
export const credentialStatus = (service) => request(service);
export const storeServiceToken = (service, token) => request(service, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
export const removeServiceToken = (service) => request(service, { method: "DELETE" });

// Brokered API call: the runtime decrypts the user's stored credential for
// `service` and relays the request to the allowlisted upstream, so the key
// never reaches this browser. Mirrors the connector branch in modules.js.
export async function connectorRequest(service, route, { method = "GET", body } = {}) {
  const projectId = activeProject();
  if (!cloudAuthEnabled()) throw new Error("Managed credential broker is available on the signed-in cloud platform.");
  const headers = await cloudAuthHeaders(projectId, body !== undefined ? { "content-type": "application/json" } : {});
  return fetch(`${RUNTIME_API}/v1/connectors/${encodeURIComponent(service)}${route}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify({ body: JSON.stringify(body) }) : undefined,
  });
}
