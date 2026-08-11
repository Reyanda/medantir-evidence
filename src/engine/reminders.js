const KEY = "medantir.operator.reminders.v1";
const listeners = new Set();

export function listReminders() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(value) ? value.filter((item) => item?.id && item?.title && item?.when) : [];
  } catch { return []; }
}

export function addReminder({ title, when }) {
  const time = new Date(when).getTime();
  if (!title?.trim() || !Number.isFinite(time)) return { ok: false, error: "A title and valid ISO date/time are required." };
  const reminder = { id: `rem_${Date.now()}`, title: title.trim().slice(0, 240), when: new Date(time).toISOString(), done: false, notified: false };
  save([...listReminders(), reminder]);
  return { ok: true, reminder };
}

export function completeReminder(id) {
  save(listReminders().map((item) => item.id === id ? { ...item, done: true } : item));
}

export function markReminderNotified(id) {
  save(listReminders().map((item) => item.id === id ? { ...item, notified: true } : item));
}

export function onReminders(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function save(items) {
  try { localStorage.setItem(KEY, JSON.stringify(items.slice(-100))); } catch { /* preference storage unavailable */ }
  for (const listener of listeners) listener(listReminders());
}

