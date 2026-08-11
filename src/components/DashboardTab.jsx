import React, { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css"; // self-hosted + code-split (was a render-blocking unpkg link)
import ReactECharts from "echarts-for-react";
import { Globe2, RefreshCw, Layers, Satellite, MapPin, Activity, MessageSquare } from "lucide-react";
import { eonetEvents, usgsEarthquakes, toDailySeries } from "../engine/connectors.js";
import { currentLocation } from "../engine/session.js";
import { askComposer } from "../engine/composerBus.js";

// Live geospatial intelligence surface. No hardcoded locations — it plots REAL
// geolocated events (NASA EONET natural events + USGS seismicity) for the currently
// selected scope, fits the map to that scope, and shows the event tempo as a plot.
// Global scope = worldwide; a country scope constrains the query + view to its bbox.

const KIND_COLOR = { earthquake: "#f43f5e", "natural-event": "#f59e0b" };

export default function DashboardTab({ embedded = false }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(null);
  const darkRef = useRef(null);
  const satRef = useRef(null);
  const [sat, setSat] = useState(false);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const loc = currentLocation();

  const refresh = useCallback(async () => {
    setLoading(true);
    const bbox = loc.code === "GLOBAL" ? null : loc.bbox;
    const [eonet, quakes] = await Promise.all([
      eonetEvents({ bbox, days: 30 }),
      usgsEarthquakes({ bbox, days: 30, minmag: 4.5 }),
    ]);
    const all = [...(eonet.events || []), ...(quakes.events || [])].filter((e) => e.lat != null && e.lon != null);
    setEvents(all);
    setLoading(false);
  }, [loc.code, loc.bbox]);

  // init map once
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: false }).setView([20, 10], 2);
    mapRef.current = map;
    darkRef.current = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { maxZoom: 20, subdomains: "abcd" }).addTo(map);
    satRef.current = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 18 });
    markersRef.current = L.layerGroup().addTo(map);
  }, []);

  // Fit to scope when it changes. Data retrieval remains an explicit action.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (loc.code === "GLOBAL") map.setView([20, 10], 2);
    else map.fitBounds([[loc.bbox[1], loc.bbox[0]], [loc.bbox[3], loc.bbox[2]]], { padding: [20, 20] });
  }, [loc.code, loc.bbox]);

  // redraw markers when events change
  useEffect(() => {
    const grp = markersRef.current;
    if (!grp) return;
    grp.clearLayers();
    for (const e of events) {
      const color = KIND_COLOR[e.kind] || "var(--color-brand-primary)";
      const icon = L.divIcon({
        className: "",
        html: `<span style="display:flex;height:14px;width:14px;transform:translate(-50%,-50%)"><span style="position:absolute;height:100%;width:100%;border-radius:9999px;background:${color};opacity:.4;animation:ping 1.5s infinite"></span><span style="position:relative;height:10px;width:10px;margin:2px;border-radius:9999px;background:${color}"></span></span>`,
      });
      L.marker([e.lat, e.lon], { icon })
        .addTo(grp)
        .bindPopup(`<b>${(e.title || "Event").slice(0, 80)}</b><br/>${e.category || e.kind}${e.magnitude ? " · M" + e.magnitude : ""}`);
    }
  }, [events]);

  const toggleSat = () => {
    const map = mapRef.current;
    if (!map) return;
    if (sat) { map.removeLayer(satRef.current); darkRef.current.addTo(map); }
    else { map.removeLayer(darkRef.current); satRef.current.addTo(map); }
    setSat(!sat);
  };

  const daily = toDailySeries(events, 30);
  const chartOption = {
    grid: { left: 30, right: 10, top: 10, bottom: 20 },
    xAxis: { type: "category", data: daily.keys.map((k) => k.slice(5)), axisLabel: { fontSize: 8, color: "#71717a" }, axisLine: { lineStyle: { color: "#3f3f46" } } },
    yAxis: { type: "value", axisLabel: { fontSize: 8, color: "#71717a" }, splitLine: { lineStyle: { color: "#27272a" } } },
    series: [{ data: daily.series, type: "line", smooth: true, areaStyle: { opacity: 0.15 }, lineStyle: { color: "#3b82f6" }, itemStyle: { color: "#3b82f6" }, symbol: "none" }],
    tooltip: { trigger: "axis" },
  };

  return (
    <div className="space-y-4">
      {!embedded && <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Globe2 className="h-6 w-6 text-[var(--color-brand-primary)]" /> Geospatial Intelligence
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleSat} className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800">
            {sat ? <Layers className="h-3.5 w-3.5" /> : <Satellite className="h-3.5 w-3.5" />} {sat ? "Dark" : "Satellite"}
          </button>
          <button onClick={refresh} disabled={loading} className="flex items-center gap-2 bg-[var(--color-brand-primary)] hover:opacity-90 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>}

      {embedded && <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-zinc-500">Live NASA EONET and USGS events scoped to {loc.name}.</div>
        <div className="flex items-center gap-2">
          <button onClick={toggleSat} className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800">{sat ? <Layers className="h-3.5 w-3.5" /> : <Satellite className="h-3.5 w-3.5" />} {sat ? "Dark" : "Satellite"}</button>
          <button onClick={refresh} disabled={loading} className="flex items-center gap-2 bg-[var(--color-brand-primary)] hover:opacity-90 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
        </div>
      </div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden" style={{ height: 460 }}>
          <div ref={containerRef} className="h-full w-full bg-zinc-900" />
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-3">
            <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-1 flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" /> Event tempo (30d)</div>
            <ReactECharts option={chartOption} style={{ height: 120 }} />
          </div>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> Live events</span>
              <span className="text-[10px] font-mono text-zinc-400">{events.length}</span>
            </div>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {events.slice(0, 40).map((e, i) => (
                <div key={i} className="flex items-start gap-1.5 border-b border-zinc-50 dark:border-zinc-800/50 pb-1 group">
                  <span className="inline-block h-1.5 w-1.5 rounded-full mt-1.5 shrink-0" style={{ background: KIND_COLOR[e.kind] || "#3b82f6" }} />
                  <a href={e.url || "#"} target="_blank" rel="noreferrer" className="flex-1 text-[11px] leading-snug text-zinc-600 dark:text-zinc-300 hover:text-[var(--color-brand-primary)]">
                    {(e.title || "Event").slice(0, 70)}{e.magnitude ? ` · M${e.magnitude}` : ""}
                  </a>
                  <button onClick={() => askComposer(`Assess this event for its intelligence significance: "${e.title}" (${e.category || e.kind}${e.magnitude ? ", M" + e.magnitude : ""}).`)} title="Ask agent" className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-[var(--color-brand-primary)] shrink-0">
                    <MessageSquare className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {events.length === 0 && !loading && <div className="py-6 text-center text-[11px] text-zinc-500">No events loaded. Select Refresh to query NASA EONET and USGS.</div>}
              {events.length === 0 && !loading && <div className="text-[11px] text-zinc-500">No geolocated events for this scope in the last 30 days.</div>}
              {loading && <div className="text-[11px] text-zinc-400">loading live events…</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
