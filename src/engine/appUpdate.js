export function entryAssetFromHtml(html) {
  const match = String(html || "").match(/<script[^>]+src=["']([^"']*\/assets\/index-[^"']+\.js)["']/i);
  if (!match) return null;
  try { return new URL(match[1], window.location.origin).pathname; } catch { return null; }
}

export function runningEntryAsset(value = globalThis.__MEDANTIR_ENTRY_URL__) {
  try { return new URL(value, window.location.origin).pathname; } catch { return null; }
}

export function appBasePath(value = globalThis.__MEDANTIR_ENTRY_URL__) {
  const running = runningEntryAsset(value);
  const assetsAt = running?.indexOf("/assets/") ?? -1;
  return assetsAt >= 0 ? `${running.slice(0, assetsAt)}/` : "/";
}

export async function newerReleaseAvailable(fetchImpl = fetch) {
  const running = runningEntryAsset();
  if (!running || !running.includes("/assets/index-")) return false;
  const response = await fetchImpl(`${appBasePath()}index.html?release-check=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) return false;
  const available = entryAssetFromHtml(await response.text());
  return !!available && available !== running;
}
