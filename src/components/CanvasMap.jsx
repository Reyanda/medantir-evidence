import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// GIS morph of the amorphous Canvas: renders a map viz spec (points with
// lat/lng + optional value) as a Leaflet map with value-scaled circle markers.
// spec.data: [{lat, lng|lon, value?, name?}]; spec.encodings can remap the fields.
export default function CanvasMap({ spec, height = 280 }) {
  const ref = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);

  useEffect(() => {
    if (map.current || !ref.current) return;
    const m = L.map(ref.current, { zoomControl: true, attributionControl: false }).setView([20, 10], 2);
    map.current = m;
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { maxZoom: 20, subdomains: "abcd" }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
  }, []);

  useEffect(() => {
    const m = map.current, grp = layer.current;
    if (!m || !grp) return;
    grp.clearLayers();
    const enc = spec?.encodings || {};
    const latK = enc.lat || "lat", lngK = enc.lng || enc.lon || "lng", valK = enc.value || "value", nameK = enc.name || "name";
    const rows = Array.isArray(spec?.data) ? spec.data : [];
    const pts = rows
      .map((r) => ({ lat: Number(r[latK]), lng: Number(r[lngK] ?? r.lon ?? r.lng), val: Number(r[valK]) || 0, name: r[nameK] }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    const max = Math.max(1, ...pts.map((p) => p.val));
    for (const p of pts) {
      const radius = p.val ? 5 + (p.val / max) * 18 : 6;
      L.circleMarker([p.lat, p.lng], { radius, color: "#8b5cf6", weight: 1.5, fillColor: "#8b5cf6", fillOpacity: 0.4 })
        .addTo(grp)
        .bindPopup(`<b>${String(p.name ?? "").slice(0, 60)}</b>${p.val ? "<br/>" + p.val : ""}`);
    }
    if (pts.length) m.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng])).pad(0.3));
    else m.setView([20, 10], 2);
  }, [spec]);

  return <div ref={ref} style={{ height }} className="w-full rounded-lg overflow-hidden bg-zinc-900" />;
}
