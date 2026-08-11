import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Globe, ArrowRight, MessageSquare, Bot, ShieldAlert, FileDown, Search, ArrowLeft, RotateCw, X, Monitor, Database, Save, FolderOpen, ScanLine, Braces, Image as ImageIcon, Table2 } from "lucide-react";
import { askComposer } from "../engine/composerBus.js";
import { authorizedBridgeHeaders, bridgeAvailable, bridgeCommand, bridgeSessionId, browseUrl, capturePerceptualSnapshot, databaseSearchTransport, databaseSessionStatus, navigate as kimiNavigate, proxyUrl, savePdf, SEARCH_ENGINES, searchViaBrowser, sessionRefFor } from "../engine/browserBridge.js";
import { getBrowserContext, onBrowserContext, updateBrowserContext } from "../engine/browserBus.js";
import { resolveAccessUrl } from "../engine/research4life.js";
import { ACCESS_POINTS, accessPoint, allKnownDatabases, discoverGateway, loadGatewayCatalog, loadSelection, saveSelection, toggleSelection } from "../engine/accessPoints.js";
import { VOCABULARIES } from "../engine/searchStrategy.js";
import { fillStoredCredentials } from "../engine/institutionalAccess.js";
import usePersistedState from "../hooks/usePersistedState.js";
import { activeProject, putFile } from "../engine/projectstore.js";
import { perceptualCaptureScript, redactPerceptualUrl, sha256Text, snapshotForProject } from "../engine/perceptualEvidence.js";

// In-app web browser. In the Electron desktop shell this uses a real Chromium
// <webview> tag — full login/MFA/proprietary-database support. In a plain browser
// it falls back to a sandboxed iframe + the kimi-webbridge daemon.

const DESKTOP = typeof window !== "undefined" && window.__medantirDesktop__?.isAvailable?.();
const QUICK = [
  { label: "OpenAlex", url: "https://openalex.org" },
  { label: "Europe PMC", url: "https://europepmc.org" },
  { label: "GDELT", url: "https://www.gdeltproject.org" },
  { label: "Ascent", url: "https://ascent.actiora.com" },
  { label: "Wikipedia", url: "https://www.wikipedia.org" },
];

// Saved-session names the review engine replays (SESSION_REFS in browserBridge).
// Saving under these exact names is what lets a review run reuse the login.
const SESSION_HINTS = [
  { match: /ovidsp\.ovid\.com/i, name: "db/ovid/qmul" },
  { match: /scopus\.com/i, name: "db/scopus/qmul" },
  { match: /webofscience\.com/i, name: "db/wos/qmul" },
  { match: /embase\.com/i, name: "db/embase/elsevier" },
  { match: /cochranelibrary\.com/i, name: "db/cochrane/qmul" },
  { match: /ebsco|research4life/i, name: "db/cinahl/research4life" },
];


export default function BrowserTab({ compact = false }) {
  const [url, setUrl] = usePersistedState("browser", "url", "");
  const [src, setSrc] = useState("");
  const [kimi, setKimi] = useState(null);
  const [engine, setEngine] = usePersistedState("browser", "engine", "livivo");
  const [query, setQuery] = usePersistedState("browser", "query", "");
  const [searchState, setSearchState] = useState("");
  const [currentUrl, setCurrentUrl] = usePersistedState("browser", "currentUrl", "");
  const [loading, setLoading] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [connections, setConnections] = useState({});
  const [connChecking, setConnChecking] = useState(false);
  const [catalog, setCatalog] = useState(() => loadGatewayCatalog());
  const [selected, setSelected] = useState(() => loadSelection());
  const [busyGateway, setBusyGateway] = useState("");
  const [gatewayError, setGatewayError] = useState({});
  const databases = useMemo(() => allKnownDatabases(), [catalog]);
  const [browseImg, setBrowseImg] = useState(null);
  const [browseVp, setBrowseVp] = useState({ w: 1440, h: 900, scrollY: 0 });
  const [perception, setPerception] = useState(null);
  const [perceptionBusy, setPerceptionBusy] = useState(false);
  const [perceptionNote, setPerceptionNote] = useState("");
  const [projectPreview, setProjectPreview] = useState(() => {
    const context = getBrowserContext();
    return context.previewHtml ? context : null;
  });
  const containerRef = useRef(null);
  const webviewRef = useRef(null);
  const browseSession = useRef(bridgeSessionId());
  const typeBuffer = useRef("");
  const typeTimer = useRef(null);

  // Emit browser context for the right pane and composer.
  const emitContext = useCallback((info) => {
    const ctx = { url: info.url || currentUrl, title: info.title || "", loading: info.loading ?? loading };
    updateBrowserContext(ctx);
    if (info.url != null) setCurrentUrl(info.url);
    if (info.loading != null) setLoading(info.loading);
    if (info.title != null) document.title = `${info.title} · Medantir`;
  }, [currentUrl, loading]);

  // Initialize the real Chromium webview (Electron only).
  const initWebview = useCallback((targetUrl) => {
    if (!DESKTOP || !containerRef.current || webviewRef.current) return;
    const api = window.__medantirDesktop__.createWebview(targetUrl || "about:blank", containerRef.current);
    if (!api) return;
    webviewRef.current = api;
    api.onNavigation(emitContext);
  }, []);

  const remoteBrowse = async (opts = {}) => {
    setLoading(true);
    const body = JSON.stringify({ action: "browse", args: opts, session: browseSession.current });
    try {
      const headers = await authorizedBridgeHeaders({ "Content-Type": "application/json" });
      const r = await fetch(browseUrl(), { method: "POST", headers, body });
      const d = await r.json();
      if (d.ok && d.base64) {
        setBrowseImg("data:" + (d.mimeType || "image/jpeg") + ";base64," + d.base64);
        setBrowseVp({ w: d.viewportWidth || 1440, h: d.viewportHeight || 900, scrollY: d.scrollY || opts.scrollY || browseVp.scrollY || 0 });
        setCurrentUrl(d.url || "");
        setLoading(false);
        updateBrowserContext({ url: d.url, title: d.title || "", loading: false, canGoBack: !!d.canGoBack });
      } else if (d.error) {
        setKimi("Browse error: " + d.error);
        setLoading(false);
      }
    } catch {
      setKimi("Bridge offline — check your connection, then retry.");
      setLoading(false);
    }
  };

  const go = (u) => {
    let target = (u || url).trim();
    if (!target) return;
    if (!/^https?:\/\//i.test(target)) target = "https://" + target;
    setUrl(target);
    setSrc(DESKTOP ? target : proxyUrl(target));
    setCurrentUrl(target);
    setLoading(true);
    setProjectPreview(null);
    updateBrowserContext({ url: target, title: "", loading: true, requestedUrl: "", previewHtml: "", previewPath: "", previewProjectId: "" });
    if (DESKTOP) {
      if (!webviewRef.current) initWebview(target);
      else webviewRef.current.navigate(target);
    } else {
      // Real Chromium remote browsing for the web app
      remoteBrowse({ url: target });
    }
  };

  const renderedImageBounds = (rect) => {
    const imageAspect = browseVp.w / browseVp.h;
    const boxAspect = rect.width / rect.height;
    const width = boxAspect > imageAspect ? rect.height * imageAspect : rect.width;
    const height = boxAspect > imageAspect ? rect.height : rect.width / imageAspect;
    return { left: rect.left + (rect.width - width) / 2, top: rect.top + (rect.height - height) / 2, width, height };
  };

  // Map clicks against the actual object-contain image, excluding letterbox margins.
  const handleBrowseClick = (e) => {
    if (DESKTOP || !browseImg || !containerRef.current) return;
    containerRef.current.focus();
    const rect = containerRef.current.getBoundingClientRect();
    const image = renderedImageBounds(rect);
    if (e.clientX < image.left || e.clientX > image.left + image.width || e.clientY < image.top || e.clientY > image.top + image.height) return;
    const clickX = Math.round(((e.clientX - image.left) / image.width) * browseVp.w);
    const clickY = Math.round(((e.clientY - image.top) / image.height) * browseVp.h);
    remoteBrowse({ clickX, clickY });
  };

  // Scroll handler
  const handleBrowseWheel = (e) => {
    if (DESKTOP || !browseImg) return;
    e.preventDefault();
    const currentScroll = browseVp.scrollY + e.deltaY;
    remoteBrowse({ scrollY: Math.max(0, currentScroll) });
  };

  // Keyboard input belongs to the focused viewport, never the entire app.
  //
  // Characters are buffered and flushed as one string. Sending a round trip per
  // keystroke — each returning a full-page screenshot — made typing an
  // institutional password effectively impossible.
  const flushTyping = useCallback(() => {
    if (typeTimer.current) { clearTimeout(typeTimer.current); typeTimer.current = null; }
    const pending = typeBuffer.current;
    typeBuffer.current = "";
    if (pending) remoteBrowse({ type: pending });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const queueTyping = (text) => {
    typeBuffer.current += text;
    if (typeTimer.current) clearTimeout(typeTimer.current);
    typeTimer.current = setTimeout(flushTyping, 220);
  };

  const handleBrowseKeyDown = (e) => {
    if (DESKTOP || !browseImg) return;
    // Paste. Without this, a password manager cannot be used at all: the old
    // handler excluded metaKey/ctrlKey, so ⌘V and Ctrl+V did nothing.
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") {
      e.preventDefault();
      navigator.clipboard?.readText?.()
        .then((text) => { if (text) { flushTyping(); remoteBrowse({ type: text }); } })
        .catch(() => setKimi("Clipboard read was blocked by the browser — click the page once, then retry the paste."));
      return;
    }
    if ((e.metaKey || e.ctrlKey) && ["a", "c", "x"].includes(e.key.toLowerCase())) {
      e.preventDefault();
      flushTyping();
      remoteBrowse({ key: e.key, modifiers: e.metaKey ? ["Meta"] : ["Control"] });
      return;
    }
    if (["Backspace", "Delete", "Enter", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(e.key)) {
      e.preventDefault();
      // Flush first: a buffered value must land in the field before Tab or Enter
      // moves focus or submits the form.
      flushTyping();
      remoteBrowse({ key: e.key, shift: e.shiftKey });
      return;
    }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      queueTyping(e.key);
    }
  };

  // Electron webview controls
  const webBack = () => webviewRef.current?.goBack();
  const webForward = () => webviewRef.current?.goForward();
  const webReload = () => webviewRef.current?.reload();
  const webStop = () => webviewRef.current?.stop();
  const browserBack = () => DESKTOP ? webBack() : remoteBrowse({ back: true });
  const browserForward = () => DESKTOP ? webForward() : remoteBrowse({ forward: true });
  const browserReload = () => DESKTOP ? webReload() : remoteBrowse({ reload: true });

  useEffect(() => {
    const current = getBrowserContext();
    if (current.previewHtml) setProjectPreview(current);
    else if (compact && current.requestedUrl) go(current.requestedUrl);
    return onBrowserContext((context) => {
      if (context.previewHtml) setProjectPreview(context);
      else if (context.requestedUrl && context.requestedUrl !== currentUrl) go(context.requestedUrl);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (DESKTOP) initWebview(); }, [initWebview]);
  // Cleanup webview on unmount
  useEffect(() => () => { webviewRef.current?.remove(); webviewRef.current = null; }, []);

  const driveWithKimi = async () => {
    setKimi("…");
    const r = await kimiNavigate(url);
    setKimi(r.ok ? "opened in the supervised Chromium bridge" : "browser bridge unavailable — the in-app browser still works");
  };

  const checkBridge = async () => setKimi(await bridgeAvailable() ? "browser bridge is reachable" : "browser bridge is offline — in-app browsing remains available");
  const exportPdf = async () => {
    if (DESKTOP && webviewRef.current) {
      const dataUrl = await webviewRef.current.captureScreenshot();
      if (dataUrl) {
        const link = document.createElement("a");
        link.href = dataUrl;
        link.download = `medantir-screenshot-${Date.now()}.png`;
        link.click();
        setKimi("Screenshot captured from Chromium webview.");
        return;
      }
    }
    const result = await savePdf("A4");
    setKimi(result.ok ? "current supervised browser page exported as PDF" : result.error || "PDF export unavailable");
  };
  const databaseSearch = async () => {
    if (!query.trim()) return;
    if (DESKTOP) {
      const e = SEARCH_ENGINES.find((x) => x.id === engine);
      if (e) go(typeof e.url === "function" ? e.url(query) : e.url);
      setSearchState(`${e?.name || engine} opened in Chromium webview.`);
      return;
    }
    setSearchState("opening supervised search…");
    const result = await searchViaBrowser(engine, query);
    setSearchState(result.ok ? `${result.engine} opened in the supervised browser` : result.error || "search route unavailable");
  };

  // Per-database sign-in state. On desktop this probes the shared Chromium
  // partition; on the web build it checks whether a saved session exists under the
  // database's sessionRef. Either way the operator sees which databases a review
  // can actually search, instead of discovering it mid-run.
  const checkConnections = async (only = null) => {
    const targets = ACCESS_POINTS.filter((gateway) => !gateway.open && (!only || gateway.id === only));
    setConnChecking(true);
    for (const db of targets) {
      setConnections((current) => ({ ...current, [db.id]: { ...current[db.id], state: "checking" } }));
      // Probe the URL a SEARCH would open. Checking the publisher's direct URL
      // while the operator's session lives on the Research4Life proxy reports
      // "sign-in required" for a database they can actually reach.
      const access = resolveAccessUrl(db.id, db.discoverUrl);
      const result = await databaseSessionStatus({ database: db.id, platform: db.platform, searchUrl: access.url });
      setConnections((current) => ({
        ...current,
        [db.id]: result.ok
          ? { state: result.authenticated ? "connected" : "signin", transport: result.transport, route: access.route, reason: result.reason, sessionRef: result.sessionRef || sessionRefFor(db.id) }
          : { state: "unknown", error: result.error },
      }));
    }
    setConnChecking(false);
  };

  // Detection reads the gateway's already-authenticated page. No credential is
  // handled here — signing in stays entirely with the operator.
  const detect = async (gatewayId) => {
    setBusyGateway(gatewayId);
    setGatewayError((current) => ({ ...current, [gatewayId]: "" }));
    try {
      // Detect from whatever the operator has open when it is that gateway's own
      // site: an Ovid or EBSCOhost picker lives behind navigation we cannot guess.
      const gateway = accessPoint(gatewayId);
      const onGatewaySite = currentUrl && gateway && new URL(gateway.loginUrl).hostname.split(".").slice(-2).join(".") === new URL(currentUrl).hostname.split(".").slice(-2).join(".");
      const result = await discoverGateway(gatewayId, onGatewaySite ? { url: currentUrl } : {});
      if (result.ok) {
        setCatalog(loadGatewayCatalog());
        setKimi(`${gateway?.name || gatewayId}: ${result.counts?.total ?? 0} database(s) detected.`);
      } else {
        setGatewayError((current) => ({ ...current, [gatewayId]: result.error || "Detection failed." }));
      }
    } catch (cause) {
      setGatewayError((current) => ({ ...current, [gatewayId]: String(cause?.message || cause) }));
    } finally {
      setBusyGateway("");
    }
  };

  // Fill the open sign-in form from the vault. Submission stays manual so an MFA
  // or consent step is never skipped past.
  const autofill = async (gatewayId) => {
    const result = await fillStoredCredentials(gatewayId);
    setKimi(result.ok
      ? `Filled ${result.filledUsername ? "username" : ""}${result.filledUsername && result.filledPassword ? " and " : ""}${result.filledPassword ? "password" : ""} — press the provider's sign-in button.`
      : result.error);
  };

  const saveSession = async () => {
    const suggested = SESSION_HINTS.find((h) => h.match.test(currentUrl || url))?.name || "";
    const name = prompt("Session name. Review recipes replay these exact names:\ndb/ovid/qmul · db/scopus/qmul · db/wos/qmul · db/cinahl/research4life", suggested);
    if (!name) return;
    const r = await bridgeCommand("save_state", { name: name.trim() });
    setKimi(r.ok ? `Session "${name.trim()}" saved with ${r.cookies ?? 0} cookies.` : `Save failed — ${r.error || "bridge unreachable"}.`);
  };
  const loadSession = async () => {
    const r = await bridgeCommand("list_states");
    const states = r.ok ? (r.states || []) : [];
    if (!states.length) { setKimi(r.ok ? "No saved sessions yet." : `Could not list sessions — ${r.error || "bridge unreachable"}.`); return; }
    const name = prompt("Saved sessions:\n" + states.join("\n") + "\n\nEnter name to load:");
    if (!name) return;
    const lr = await bridgeCommand("load_state", { name: name.trim() });
    setKimi(lr.ok ? `Session "${name.trim()}" loaded with ${lr.cookies ?? 0} cookies.` : `Load failed — ${lr.error || "bridge unreachable"}.`);
    if (lr.ok && currentUrl && !DESKTOP) remoteBrowse({ url: currentUrl });
  };

  const capturePerception = async () => {
    if (!currentUrl && !src) { setPerceptionNote("Open a page first."); return; }
    setPerceptionBusy(true);
    setPerceptionNote("");
    try {
      let snapshot;
      if (DESKTOP && webviewRef.current) {
        const scene = await webviewRef.current.executeScript(perceptualCaptureScript());
        const dataUrl = await webviewRef.current.captureScreenshot();
        const capturedAt = new Date().toISOString();
        const safeUrl = redactPerceptualUrl(webviewRef.current.getURL?.() || currentUrl || url);
        const title = webviewRef.current.getTitle?.() || "";
        const rasterBase64 = dataUrl?.includes(",") ? dataUrl.split(",")[1] : null;
        const structuralSha256 = await sha256Text(JSON.stringify({ safeUrl, title, capturedAt, scene }));
        const rasterSha256 = rasterBase64 ? await sha256Text(rasterBase64) : null;
        snapshot = {
          schema: "medantir.perceptual-evidence-snapshot.v1",
          url: safeUrl, title, capturedAt,
          runtime: { engine: "electron-chromium-webview", sessionScoped: true },
          scene, accessibility: null, structuralSha256,
          raster: rasterBase64 ? { mimeType: "image/png", base64: rasterBase64, sha256: rasterSha256, scope: "viewport" } : undefined,
        };
      } else {
        const result = await capturePerceptualSnapshot({ includeRaster: true });
        if (!result.ok) throw new Error(result.error || "Perceptual capture failed");
        snapshot = result;
      }
      setPerception(snapshot);
      const counts = snapshot.scene?.counts || {};
      setPerceptionNote(`Captured ${counts.elements || 0} rendered elements, ${counts.vectors || 0} vector primitives, and ${counts.tables || 0} tables.`);
    } catch (cause) {
      setPerceptionNote(String(cause?.message || cause));
    } finally {
      setPerceptionBusy(false);
    }
  };

  const savePerception = () => {
    if (!perception) return;
    const projectId = activeProject();
    if (!projectId) { setPerceptionNote("Select an active project before saving perceptual evidence."); return; }
    const safe = snapshotForProject(perception);
    const path = `evidence/perception-${Date.now()}.json`;
    putFile(projectId, { path, name: "Perceptual evidence snapshot", type: "perceptual-evidence", content: JSON.stringify(safe, null, 2), meta: { kind: "rendered-vector-scene", sourceUrl: safe.url, structuralSha256: safe.structuralSha256 } });
    setPerceptionNote(`Saved structured scene to ${path}; screenshot bytes were intentionally omitted from project storage.`);
  };

  const btn = "flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-30 transition-colors";

  const perceptionPanel = perception && (() => {
    const counts = perception.scene?.counts || {};
    const rasterSrc = perception.raster?.base64 ? `data:${perception.raster.mimeType || "image/jpeg"};base64,${perception.raster.base64}` : null;
    return (
      <section className="ui-panel space-y-3" aria-label="Perceptual evidence snapshot">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="ui-kicker flex items-center gap-1.5"><ScanLine className="h-3.5 w-3.5" /> Perceptual evidence</div>
            <div className="text-xs font-semibold mt-1">RenderedVectorScene · {perception.runtime?.engine || "Chromium"}</div>
            <div className="text-[10px] text-zinc-500 mt-1 break-all">{perception.url}</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={capturePerception} disabled={perceptionBusy} className="ui-secondary-button px-2.5 py-1.5 text-[10px]"><ScanLine className="h-3.5 w-3.5" /> Refresh</button>
            <button onClick={savePerception} className="ui-secondary-button px-2.5 py-1.5 text-[10px]"><Save className="h-3.5 w-3.5" /> Save to project</button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            ["Elements", counts.elements || 0, Braces],
            ["Vectors", counts.vectors || 0, ScanLine],
            ["Tables", counts.tables || 0, Table2],
            ["Canvas fallbacks", counts.canvases || 0, ImageIcon],
          ].map(([label, value, Icon]) => <div key={label} className="ui-card"><div className="flex items-center gap-1.5 text-[10px] text-zinc-500"><Icon className="h-3.5 w-3.5" /> {label}</div><div className="ui-stat-value mt-1">{value}</div></div>)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-3">
          <div className="rounded-md border p-3 min-w-0" style={{ borderColor: "var(--color-border-subtle)", background: "var(--color-bg-elevated)" }}>
            <div className="ui-kicker">Audit contract</div>
            <div className="mt-2 grid sm:grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-zinc-500 font-mono">
              <span>structure {perception.structuralSha256?.slice(0, 18) || "unhashed"}</span>
              <span>raster {perception.raster?.sha256?.slice(0, 18) || "not retained"}</span>
              <span>form values {perception.scene?.redaction?.formValues || "removed"}</span>
              <span>URL secrets {perception.scene?.redaction?.sensitiveUrlParameters || "redacted"}</span>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">DOM geometry, text structure, native SVG primitives, and tables are captured as structured evidence. Canvas content remains explicitly marked as raster-only instead of being misrepresented as vector data.</p>
          </div>
          <div className="rounded-md border overflow-hidden min-h-32 flex items-center justify-center" style={{ borderColor: "var(--color-border-subtle)", background: "var(--color-bg-elevated)" }}>
            {rasterSrc ? <img src={rasterSrc} alt="Viewport verification captured with perceptual evidence" className="w-full h-40 object-contain" /> : <span className="text-[10px] text-zinc-500 p-3">No raster verification frame retained.</span>}
          </div>
        </div>
      </section>
    );
  })();

  // Database connections + Research4Life discovery. Rendered in BOTH the full
  // tab and the 430px right pane, because the sidebar routes "browser" to the
  // pane — leaving this only in the full tab put it somewhere unreachable.
  // Sign in per ACCESS POINT, then tick the databases it turned out to provide.
  // The old panel listed eight providers as if they were the unit of access; in
  // reality one gateway login opens many databases and which ones depends on the
  // subscription, so the list is discovered rather than declared.
  const databasePanel = showSessions && (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.03] p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-500 flex items-center gap-1.5"><Database className="h-3.5 w-3.5" /> Access points</div>
        <button onClick={() => setShowSessions(false)} className="text-[10px] text-zinc-400 hover:text-zinc-600">Hide</button>
      </div>
      <div className="text-[11px] text-zinc-500">
        {DESKTOP
          ? "Sign in to a gateway once. Its databases are detected and appear below to tick — searches reuse this same Chromium session, so SSO and MFA work and your credentials never leave this machine."
          : "Sign in to a gateway, then detect its databases. Saved sessions are replayed for institutional search."}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {ACCESS_POINTS.map((gateway) => {
          const conn = connections[gateway.id] || {};
          const found = (catalog[gateway.id]?.databases || []).length;
          const badge = gateway.open
            ? { label: "Open access", tone: "text-emerald-500" }
            : conn.state === "connected" ? { label: "Signed in", tone: "text-emerald-500" }
            : conn.state === "signin" ? { label: "Sign-in required", tone: "text-amber-500" }
            : conn.state === "checking" ? { label: "Checking…", tone: "text-zinc-400" }
            : conn.state === "unknown" ? { label: "Unknown", tone: "text-rose-400" }
            : { label: "Not checked", tone: "text-zinc-400" };
          return (
            <div key={gateway.id} className="flex flex-col gap-1 p-2 rounded-lg border border-zinc-200 dark:border-zinc-700">
              <span className="text-xs font-medium">{gateway.name}</span>
              <span className={`text-[9px] font-mono font-semibold ${badge.tone}`}>{badge.label}{found ? ` · ${found} db` : ""}</span>
              <span className="text-[9px] text-zinc-400 leading-tight">{gateway.note}</span>
              <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                <button onClick={() => go(gateway.loginUrl)} className="text-[9px] font-medium px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-amber-500/10">{gateway.open ? "Open" : "Sign in"}</button>
                {!gateway.open && <button onClick={() => checkConnections(gateway.id)} disabled={connChecking} className="text-[9px] font-medium px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 disabled:opacity-40">Verify</button>}
                {!gateway.open && DESKTOP && <button onClick={() => autofill(gateway.id)} title="Fill this gateway's sign-in form from your vault" className="text-[9px] font-medium px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700">Fill</button>}
                <button onClick={() => detect(gateway.id)} disabled={busyGateway === gateway.id} className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/30 disabled:opacity-40">{busyGateway === gateway.id ? "Detecting…" : "Detect"}</button>
              </div>
              {conn.reason && <span className="text-[9px] break-words" style={{ color: "var(--color-text-secondary)" }}>{conn.reason}{conn.route === "research4life" ? " · via R4L" : ""}</span>}
              {gatewayError[gateway.id] && <span className="text-[9px] text-rose-400 break-words">{gatewayError[gateway.id]}</span>}
            </div>
          );
        })}
      </div>

      {/* Detected databases. Nothing is preselected — the strategy compiles for
          exactly what is ticked, and each row states the syntax it will use. */}
      <div className="pt-1 border-t border-zinc-100 dark:border-zinc-800 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Databases to search</span>
          <span className="text-[9px] font-mono" style={{ color: "var(--color-text-secondary)" }}>{selected.length} of {databases.length} selected</span>
          {databases.length > 0 && <button onClick={() => { const next = selected.length === databases.length ? [] : databases.map((d) => d.id); saveSelection(next); setSelected(next); }} className="text-[9px] px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700">{selected.length === databases.length ? "Clear all" : "Select all"}</button>}
        </div>
        {databases.length === 0 ? (
          <div className="text-[10px] text-zinc-500">No databases detected yet. Sign in to a gateway above, open its database selector, then press Detect.</div>
        ) : (
          <div className="max-h-40 overflow-y-auto space-y-0.5">
            {databases.map((database) => (
              <label key={database.id} className="flex items-center gap-1.5 text-[10px] cursor-pointer hover:bg-amber-500/[0.04] rounded px-1 py-0.5">
                <input type="checkbox" checked={selected.includes(database.id)} onChange={() => { const next = toggleSelection(database.id); setSelected(next); }} className="h-3 w-3 shrink-0" />
                <span className="truncate flex-1">{database.name}</span>
                <span className="font-mono text-[9px] shrink-0" style={{ color: "var(--color-text-secondary)" }}>{database.platformName}</span>
                <span className="font-mono text-[9px] shrink-0" style={{ color: database.freeTextOnly ? "var(--color-text-secondary)" : "var(--color-brand-primary)" }}>{database.freeTextOnly ? "free-text" : VOCABULARIES[database.vocabulary]}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-zinc-100 dark:border-zinc-800">
        <button onClick={() => checkConnections()} disabled={connChecking} className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded bg-amber-500/10 text-amber-500 border border-amber-500/30 disabled:opacity-40">
          <Database className="h-3 w-3" /> {connChecking ? "Checking…" : "Verify all"}
        </button>
        {!DESKTOP && <>
          <button onClick={saveSession} className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700"><Save className="h-3 w-3" /> Save session</button>
          <button onClick={loadSession} className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700"><FolderOpen className="h-3 w-3" /> Load session</button>
        </>}
        <span className="text-[9px] font-mono text-zinc-400 ml-auto">
          search transport: {databaseSearchTransport() === "desktop" ? "this Chromium session" : "supervised cloud bridge"}
        </span>
      </div>
    </div>
  );

  if (compact) {
    return (
      <div className="h-full min-h-0 flex flex-col p-2 gap-2">
        <div className="flex items-center gap-1.5">
          <button onClick={browserBack} disabled={!currentUrl} title="Back" aria-label="Browser back" className={btn}><ArrowLeft className="h-3 w-3" /></button>
          <button onClick={browserForward} disabled={!currentUrl} title="Forward" aria-label="Browser forward" className={btn}><ArrowLeft className="h-3 w-3 rotate-180" /></button>
          <button onClick={browserReload} disabled={!currentUrl} title="Reload" aria-label="Reload browser" className={btn}><RotateCw className="h-3 w-3" /></button>
          <input value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => event.key === "Enter" && go()} placeholder="https://…" aria-label="Right pane browser URL" className="min-w-0 flex-1 text-[11px] font-mono px-2 py-1.5 rounded border outline-none" style={{ background: "var(--color-bg-elevated)", borderColor: "var(--color-border-subtle)" }} />
          <button onClick={() => go()} disabled={!url.trim()} className="h-7 px-2 rounded text-[10px] font-medium text-white disabled:opacity-40" style={{ background: "var(--color-brand-primary)" }}>Go</button>
          <button disabled={!currentUrl && !projectPreview} onClick={() => askComposer(projectPreview ? `Review the project web preview ${projectPreview.previewPath}.` : `Analyze this page and its content: ${currentUrl}`)} aria-label="Chat about right pane browser" className={btn}><MessageSquare className="h-3 w-3" /></button>
          <button onClick={() => setShowSessions(!showSessions)} title="Database connections and Research4Life detection" aria-label="Database connections" className={btn} style={showSessions ? { color: "var(--color-brand-primary)" } : undefined}><Database className="h-3 w-3" /></button>
          <button onClick={capturePerception} disabled={perceptionBusy || (!currentUrl && !src)} title="Capture rendered vector evidence" aria-label="Capture perceptual evidence" className={btn} style={perception ? { color: "var(--color-brand-primary)" } : undefined}><ScanLine className="h-3 w-3" /></button>
        </div>
        <div className="text-[9px] font-mono text-zinc-400 truncate">{projectPreview ? `${projectPreview.url} · isolated preview` : currentUrl || "No page loaded"}</div>
        {databasePanel && <div className="max-h-[55%] overflow-y-auto">{databasePanel}</div>}
        {perception && <div className="rounded border px-2 py-1.5 text-[9px] font-mono flex items-center gap-2" style={{ borderColor: "var(--color-border-subtle)", background: "var(--color-bg-elevated)" }}><ScanLine className="h-3 w-3" style={{ color: "var(--color-brand-primary)" }} /><span className="truncate">Vector scene: {perception.scene?.counts?.elements || 0} nodes · {perception.scene?.counts?.vectors || 0} vectors · {perception.structuralSha256?.slice(0, 10) || "unhashed"}</span></div>}
        <div ref={containerRef} tabIndex={projectPreview || DESKTOP ? -1 : 0} role="region" aria-label="Interactive in-app browser viewport" className="flex-1 min-h-0 rounded border overflow-hidden relative bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-primary)]/50" style={{ borderColor: "var(--color-border-subtle)", cursor: browseImg && !DESKTOP ? "pointer" : "default" }} onClick={projectPreview ? undefined : handleBrowseClick} onWheel={projectPreview ? undefined : handleBrowseWheel} onKeyDown={projectPreview ? undefined : handleBrowseKeyDown}>
          {projectPreview ? <iframe title={`Preview ${projectPreview.previewPath}`} srcDoc={projectPreview.previewHtml} sandbox="allow-scripts allow-forms allow-modals" className="w-full h-full border-0" /> : DESKTOP ? (!src && <CompactEmpty text="Enter a URL to browse." />) : browseImg ? <img src={browseImg} alt="Remote browser" className="w-full h-full object-contain" draggable={false} /> : loading ? <CompactEmpty text="Loading via Chromium…" /> : <CompactEmpty text="Enter a URL or preview an HTML project file." />}
          {loading && browseImg && <div className="pointer-events-none absolute top-2 right-2 rounded-full px-2 py-1 text-[9px] font-medium shadow" style={{ background: "var(--color-bg-surface)", color: "var(--color-text-secondary)" }}>Updating…</div>}
        </div>
        <div className="flex items-center justify-between gap-2 text-[9px] text-zinc-500"><span>{projectPreview ? "Sandboxed project preview" : DESKTOP ? "Chromium webview" : "Supervised Chromium bridge"}</span>{!DESKTOP && !projectPreview && <button onClick={driveWithKimi} disabled={!url.trim()} className="font-medium hover:underline disabled:opacity-40">Open with Kimi</button>}</div>
      </div>
    );
  }

  return (
    <div className="ui-page">
      <div className="ui-page-header">
        <div>
          <h1 className="ui-title"><Globe className="h-5 w-5" /> Research Browser</h1>
          <p className="ui-subtitle">Authenticated browsing, source execution, and perceptual evidence capture in one auditable workspace.</p>
        </div>
        {DESKTOP && <span className="text-[9px] font-mono font-bold px-2 py-1 rounded border flex items-center gap-1 text-emerald-500" style={{ borderColor: "rgb(var(--state-done-rgb) / 0.35)" }}><Monitor className="h-3 w-3" /> LOCAL CHROMIUM</span>}
      </div>

      {/* URL bar + navigation controls */}
      <div className="ui-toolbar">
        <button onClick={browserBack} disabled={!currentUrl} title="Back" className={btn}><ArrowLeft className="h-3.5 w-3.5" /></button>
        <button onClick={browserForward} disabled={!currentUrl} title="Forward" className={btn}><ArrowLeft className="h-3.5 w-3.5 rotate-180" /></button>
        <button onClick={loading && DESKTOP ? webStop : browserReload} disabled={!currentUrl} title={loading && DESKTOP ? "Stop" : "Reload"} className={btn}>{loading && DESKTOP ? <X className="h-3.5 w-3.5" /> : <RotateCw className="h-3.5 w-3.5" />}</button>
        <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} placeholder="https://…"
          className="min-w-56 flex-1 text-sm px-3 py-2 rounded-md border outline-none font-mono" style={{ background: "var(--color-bg-elevated)", borderColor: "var(--color-border-subtle)" }} />
        <button onClick={() => go()} disabled={!url.trim()} className="ui-primary-button disabled:opacity-50 text-sm px-3 py-2"><ArrowRight className="h-4 w-4" /> Go</button>
        <button disabled={!currentUrl && !url.trim()} onClick={() => askComposer(`Analyze this page and its content: ${currentUrl || url}`)} title="Chat with the agent about this page" className="ui-secondary-button disabled:opacity-50 text-sm px-3 py-2"><MessageSquare className="h-4 w-4" /> Ask agent</button>
        {!DESKTOP && (
          <button disabled={!url.trim()} onClick={driveWithKimi} title="Drive real browser via supervised bridge" className="ui-secondary-button disabled:opacity-50 text-sm px-3 py-2"><Bot className="h-4 w-4" /> Bridge</button>
        )}
        <button onClick={() => setShowSessions(!showSessions)} className="ui-secondary-button text-sm px-3 py-2" style={showSessions ? { color: "rgb(var(--state-caution-rgb))", borderColor: "rgb(var(--state-caution-rgb) / 0.45)" } : undefined}><Database className="h-4 w-4" /> Access</button>
        <button onClick={capturePerception} disabled={perceptionBusy || (!currentUrl && !src)} className="ui-secondary-button disabled:opacity-50 text-sm px-3 py-2" style={perception ? { color: "var(--color-brand-primary)", borderColor: "var(--color-brand-primary)" } : undefined}><ScanLine className="h-4 w-4" /> {perceptionBusy ? "Capturing…" : "Capture evidence"}</button>
        <button disabled={!src && !currentUrl} onClick={exportPdf} title={DESKTOP ? "Capture screenshot" : "Export the supervised browser page"} className="ui-secondary-button disabled:opacity-50 text-sm px-3 py-2"><FileDown className="h-4 w-4" /> {DESKTOP ? "Shot" : "PDF"}</button>
      </div>

      {/* Database search bar */}
      <div className="ui-panel flex items-center gap-2 flex-wrap">
        <Search className="h-4 w-4" style={{ color: "var(--color-text-secondary)" }} />
        <select value={engine} onChange={(event) => setEngine(event.target.value)} aria-label="Supervised database" className="text-xs px-2 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">{SEARCH_ENGINES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && databaseSearch()} placeholder="compiled strategy or search terms…" aria-label="Supervised database query" className="flex-1 min-w-48 text-xs px-3 py-2 rounded-md border outline-none" style={{ background: "var(--color-bg-elevated)", borderColor: "var(--color-border-subtle)" }} />
        <button onClick={databaseSearch} className="ui-primary-button text-xs px-3 py-2">Open search</button>
        {!DESKTOP && <button onClick={checkBridge} className="text-xs font-medium px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700">Check bridge</button>}
        {searchState && <div className="w-full text-[10px] font-mono" style={{ color: "var(--color-text-secondary)" }}>{searchState}</div>}
      </div>

      {/* Quick links */}
      <div className="flex flex-wrap gap-2">
        {QUICK.map((q) => (
          <button key={q.label} onClick={() => go(q.url)} className="text-[11px] px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800">{q.label}</button>
        ))}
      </div>

      {kimi && !DESKTOP && <div className="text-[11px] font-mono flex items-center gap-1.5" style={{ color: "var(--color-text-secondary)" }}><Bot className="h-3.5 w-3.5" /> {kimi}</div>}
      {DESKTOP && currentUrl && <div className="text-[10px] font-mono text-zinc-400 truncate">{currentUrl}</div>}

      {databasePanel}
      {perceptionPanel}
      {perceptionNote && <div className="text-[10px] font-mono" style={{ color: "var(--color-text-secondary)" }}>{perceptionNote}</div>}

      {/* Browser viewport: Chromium webview (Electron) or sandboxed iframe (web) */}
      <div
        ref={containerRef}
        tabIndex={DESKTOP ? -1 : 0}
        role="region"
        aria-label="Interactive in-app browser viewport"
        className="rounded-lg border overflow-hidden bg-white dark:bg-[#15181c] relative focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-primary)]/40" style={{ height: "62vh", cursor: browseImg && !DESKTOP ? "pointer" : "default", borderColor: "var(--color-border-subtle)" }}
        onClick={handleBrowseClick}
        onWheel={handleBrowseWheel}
        onKeyDown={handleBrowseKeyDown}
      >
        {DESKTOP ? (
          !src ? <div className="h-full flex items-center justify-center text-sm text-zinc-500">No page loaded.</div> : null
        ) : browseImg ? (
          <img src={browseImg} alt="Remote browser" className="w-full h-full object-contain" draggable={false} />
        ) : loading ? (
          <div className="h-full flex items-center justify-center"><span className="text-sm text-zinc-500">Loading page via Chromium…</span></div>
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-zinc-500">Enter a URL and press Go to browse with real Chromium.</div>
        )}
        {loading && browseImg && <div className="pointer-events-none absolute top-2 right-2 rounded-full px-2 py-1 text-[9px] font-medium shadow" style={{ background: "var(--color-bg-surface)", color: "var(--color-text-secondary)" }}>Updating…</div>}
      </div>
      <div className="text-[10px] font-mono text-zinc-400 flex items-center gap-1.5">
        <ShieldAlert className="h-3.5 w-3.5" /> {DESKTOP ? "Chromium webview — real browser with persistent session." : browseImg ? `Real Chromium via bridge.actiora.com — click to interact, type to input, scroll to navigate.` : "Enter a URL above to start real Chromium browsing."}
      </div>
    </div>
  );
}

function CompactEmpty({ text }) {
  return <div className="h-full flex items-center justify-center p-4 text-center text-[10px] text-zinc-500">{text}</div>;
}
