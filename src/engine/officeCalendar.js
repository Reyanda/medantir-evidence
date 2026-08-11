// officeCalendar.js — Local-first calendaring for the Office surface.
//
// Events live in localStorage (per user), so the calendar works offline with
// zero accounts. Export produces a real .ics file that Google Calendar,
// Outlook and Apple Calendar all import. A Google Calendar sync would ride the
// same OAuth token as officeMail once the user grants the calendar scope — the
// hook is left at the boundary (`syncProvider`), not stubbed.

import { currentVaultUserId } from "./secureVault.js";

const STORE_KEY = "medantir.office.calendar.v1";

function store() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : { events: [] };
  } catch { return { events: [] }; }
}

function save(data) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch { /* quota */ }
}

function uid() {
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function listEvents({ from, to } = {}) {
  const { events } = store();
  if (!from && !to) return [...events].sort((a, b) => a.start - b.start);
  const start = from != null ? Number(from) : -Infinity;
  const end = to != null ? Number(to) : Infinity;
  return events.filter((e) => e.start < end && (e.end || e.start + 3600_000) > start)
    .sort((a, b) => a.start - b.start);
}

export function getEvent(id) {
  return store().events.find((e) => e.id === id) || null;
}

export function upsertEvent({ id, title, start, end, allDay = false, notes = "", projectId = null }) {
  const data = store();
  const now = Date.now();
  const existing = id ? data.events.find((e) => e.id === id) : null;
  const event = {
    id: id || uid(),
    title: String(title || "Untitled").trim() || "Untitled",
    start: Number(start) || now,
    end: Number(end) || (Number(start) || now) + 3600_000,
    allDay: !!allDay,
    notes: String(notes || ""),
    projectId: projectId || existing?.projectId || null,
    created: existing?.created || now,
    updated: now,
  };
  if (existing) data.events = data.events.map((e) => (e.id === event.id ? event : e));
  else data.events.push(event);
  save(data);
  return event;
}

export function deleteEvent(id) {
  const data = store();
  data.events = data.events.filter((e) => e.id !== id);
  save(data);
  return { ok: true };
}

function icsDate(ms, allDay) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  const base = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  return allDay ? base : `${base}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
}

/** Export all events as a downloadable .ics file (RFC 5545). */
export function exportICS(events = listEvents()) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Reyanda//Medantir Office//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const e of events) {
    const row = [
      "BEGIN:VEVENT",
      `UID:${e.id}@medantir.local`,
      `DTSTAMP:${icsDate(e.created || Date.now(), false)}`,
      `DTSTART:${icsDate(e.start, e.allDay)}`,
      e.allDay ? "" : `DTEND:${icsDate(e.end || e.start + 3600_000, false)}`,
      `SUMMARY:${String(e.title).replace(/[;,:\n]+/g, " ").replace(/\s{2,}/g, " ").trim()}`,
      e.notes ? `DESCRIPTION:${String(e.notes).replace(/[;,:\n]+/g, " ").replace(/\s{2,}/g, " ").trim()}` : "",
      "END:VEVENT",
    ];
    for (const l of row) { if (l) lines.push(l); }
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function downloadICS(events) {
  const blob = new Blob([exportICS(events)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `medantir-calendar-${new Date().toISOString().slice(0, 10)}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Boundary hook: a Google Calendar sync would be implemented here with the same
// OAuth token as officeMail (scope: calendar.events). Deliberately not stubbed
// with fake events — sync stays honest until the scope is granted.
export function syncProvider() {
  return { ok: false, state: "not-configured", error: "Google Calendar sync requires the calendar scope on the Gmail token." };
}

export function calendarStats() {
  const events = listEvents();
  const upcoming = events.filter((e) => e.start > Date.now()).length;
  return { total: events.length, upcoming, user: currentVaultUserId() };
}
