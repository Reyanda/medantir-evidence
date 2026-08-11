import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css"; // self-hosted + code-split with the map chunk

// Reusable embedded GIS map. Plots geolocated events inside the app so monitors
// (and any surface) visualise on-map instead of opening external links. Fits to the
// events, or to a provided bbox [w,s,e,n] when there are none.

const KIND_COLOR = { earthquake: "#f43f5e", "natural-event": "#f59e0b", conflict: "#dc2626", default: "var(--color-brand-primary)" };

export default function MiniMap({ events = [], bbox, height = 260, onSelect }) {
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
    const geo = events.filter((e) => e.lat != null && e.lon != null);
    for (const e of geo) {
      const color = KIND_COLOR[e.kind] || KIND_COLOR.default;
      const icon = L.divIcon({ className: "", html: `<span style="display:block;height:12px;width:12px;border-radius:9999px;background:${color};border:2px solid #09090b;transform:translate(-50%,-50%)"></span>` });
      const popup = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = (e.title || "Event").slice(0, 80);
      popup.appendChild(title);
      if (e.magnitude) {
        popup.appendChild(document.createElement("br"));
        popup.appendChild(document.createTextNode(`M${e.magnitude}`));
      }
      const mk = L.marker([e.lat, e.lon], { icon }).addTo(grp).bindPopup(popup);
      if (onSelect) mk.on("click", () => onSelect(e));
    }
    if (geo.length) {
      m.fitBounds(L.latLngBounds(geo.map((e) => [e.lat, e.lon])).pad(0.3));
    } else if (bbox) {
      m.fitBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]], { padding: [15, 15] });
    } else {
      m.setView([20, 10], 2);
    }
  }, [events, bbox, onSelect]);

  return <div ref={ref} style={{ height }} className="w-full rounded-lg overflow-hidden bg-zinc-900" />;
}
