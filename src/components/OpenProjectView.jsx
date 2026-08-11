import React, { useEffect, useState } from "react";
import {
  Ban, Briefcase, Building2, ChartNoAxesGantt, CheckCircle2, ChevronRight, CircleDashed, CircleDot,
  FlaskConical, FolderOpen, FolderPlus, FolderTree, Gauge, GraduationCap, History, Hourglass,
  Landmark, Layers, Loader2, Milestone, Plus, Route, Rows3, SlidersHorizontal, SquareKanban,
  Sparkles, Target, Timer, Trash2, Unlink,
} from "lucide-react";
import {
  PILLARS, ROADMAP_TEMPLATES, STATUS_LABELS, WORK_PRIORITIES, WORK_STATUSES, WORK_TYPES,
  applyTemplate, createWorkPackage, currentQuarter, formatQuarter, migrateLegacyRoadmap,
  onRoadmapChanged, quarterIndex, removeWorkPackage, roadmapSpan, roadmapStats, updateWorkPackage,
  workPackageTree,
} from "../engine/roadmap.js";
import { attachFolderToProject, detachFolderFromProject, setActiveProject } from "../engine/projectstore.js";
import {
  activeTenantId, canDelete, canEdit, canManageMembers, listTenants, memberRole,
  onTenancyChanged, roadmapLabels, setActiveTenant, updateTenant,
} from "../engine/tenancy.js";
import ConfirmDelete from "./ConfirmDelete.jsx";

// The plan view over projectstore. A row here IS a project — the same record that
// owns the folder, files and runs — so scheduling a line item and attaching its
// folder are one act rather than two linked things.
//
// Every icon below denotes exactly one concept; no glyph is reused for a second
// meaning, so the symbol itself carries information rather than decoration.

const TYPE_ICON = { Phase: Layers, Task: CircleDot, Feature: Sparkles, Milestone };
const PILLAR_ICON = {
  Portfolio: Landmark,
  Product: FlaskConical,
  Research: GraduationCap,
  Advisory: Briefcase,
  Ventures: Route,
};

// Colour resolves through the design system's semantic state layer, never through
// literal palette classes — switching palette or appearance repaints this view
// without a code change, and "in progress" tracks whichever accent is selected.
const STATUS_TOKEN = { backlog: "idle", scoping: "info", active: "active", blocked: "blocked", done: "done" };
const STATUS_ICON = { backlog: CircleDashed, scoping: Target, active: Timer, blocked: Ban, done: CheckCircle2 };

const statusColor = (status) => `rgb(var(--state-${STATUS_TOKEN[status] || "idle"}-rgb))`;
const priorityToken = (priority) => `--priority-${String(priority).toLowerCase()}-rgb`;

const priorityChip = (priority) => ({
  color: `rgb(var(${priorityToken(priority)}))`,
  backgroundColor: `rgb(var(${priorityToken(priority)}) / 0.12)`,
  borderColor: `rgb(var(${priorityToken(priority)}) / 0.32)`,
});

const VIEWS = [
  { id: "wbs", label: "Work breakdown", icon: Rows3 },
  { id: "kanban", label: "Kanban", icon: SquareKanban },
  { id: "gantt", label: "Timeline", icon: ChartNoAxesGantt },
];

const card = "chrome-surface border";
const control = "rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)] text-[11px] text-[var(--color-text-primary)] px-1.5 py-1 outline-none focus:border-[var(--color-brand-primary)]";
const ghostButton = "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)]";

export default function OpenProjectView() {
  const [, force] = useState(0);
  const [view, setView] = useState("wbs");
  const [pillar, setPillar] = useState("All");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [notice, setNotice] = useState("");

  const refresh = () => force((value) => value + 1);
  useEffect(() => onRoadmapChanged(refresh), []);
  useEffect(() => onTenancyChanged(refresh), []);

  // Work packages written by the former standalone store are imported once, so
  // an existing plan survives the move into projectstore.
  useEffect(() => {
    const { imported } = migrateLegacyRoadmap();
    if (imported) setNotice(`Imported ${imported} work packages from the previous roadmap store. Each is now a full project.`);
  }, []);

  const tenants = listTenants();
  const tenantId = activeTenantId();
  const role = memberRole(tenantId);
  const editable = canEdit(tenantId);
  const deletable = canDelete(tenantId);
  const administrable = canManageMembers(tenantId);
  const labels = roadmapLabels(tenantId);

  const tree = workPackageTree(tenantId);
  const pillars = ["All", ...new Set(tree.map((item) => item.pillar).filter(Boolean))];
  const visible = pillar === "All" ? tree : tree.filter((item) => item.pillar === pillar);
  const stats = roadmapStats(visible);
  const span = roadmapSpan(visible);
  const origin = span?.from ?? quarterIndex(currentQuarter());

  const addPackage = () => {
    const created = createWorkPackage({
      pillar: pillar === "All" ? PILLARS[1].id : pillar,
      subject: "New work package",
      start: formatQuarter(origin),
      end: formatQuarter(origin + 3),
    });
    setNotice(`Added “${created.subject}”. It is a full project — attach a folder to it when ready.`);
  };

  const chooseTemplate = (templateId) => {
    if (!templateId) return;
    const result = applyTemplate(templateId, { tenantId, startQuarter: currentQuarter() });
    setNotice(result.ok ? `Applied the ${result.template} template — ${result.added} work packages added.` : result.error);
  };

  const confirmDelete = (authorisation) => {
    const result = removeWorkPackage(pendingDelete.id, authorisation);
    setPendingDelete(null);
    setNotice(result.ok
      ? `Deleted “${result.removed.subject}” and everything it owned. Children were re-parented, not destroyed.`
      : result.error);
  };

  return (
    <div className="w-full space-y-5 p-6 text-[var(--color-text-primary)]">
      {/* Tailwind breakpoints track the viewport, but this view renders inside a
          column narrowed by the sidebar and right pane. Staying stacked until the
          window is genuinely wide stops the tab group from crushing the title. */}
      <header className={`flex flex-col gap-4 p-5 2xl:flex-row 2xl:items-center 2xl:justify-between ${card}`}>
        <div className="min-w-0">
          {/* Headings are tenant data. An owner edits them in place; a shipped
              build carries no previous owner's naming. */}
          <input
            value={labels.title}
            readOnly={!administrable}
            aria-label="Roadmap title"
            onChange={(event) => updateTenant(tenantId, { roadmapTitle: event.target.value })}
            className="w-full bg-transparent text-xl font-bold tracking-tight outline-none focus:underline"
          />
          <input
            value={labels.subtitle}
            readOnly={!administrable}
            aria-label="Roadmap subtitle"
            onChange={(event) => updateTenant(tenantId, { roadmapSubtitle: event.target.value })}
            className="mt-0.5 w-full bg-transparent text-sm text-[var(--color-text-secondary)] outline-none focus:underline"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Building2 className="h-3.5 w-3.5 text-[var(--color-text-secondary)]" />
            <select
              value={tenantId || ""}
              onChange={(event) => setActiveTenant(event.target.value)}
              aria-label="Active tenant"
              className={control}
            >
              {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
            </select>
            <span className="rounded-full border border-[var(--color-border-subtle)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-secondary)]">
              {role ? `You are ${role}` : "No access to this tenant"}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1 self-start rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)] p-1 2xl:self-auto">
          {VIEWS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setView(id)}
              aria-pressed={view === id}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                view === id
                  ? "bg-[var(--color-brand-primary)] text-white"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric icon={Target} label="Work packages" value={stats.total} tone="text-[var(--color-text-primary)]" />
        <Metric icon={Hourglass} label="Estimated effort" value={`${stats.hours.toLocaleString()} h`} tone="text-sky-500" />
        <Metric icon={FolderTree} label="With a folder" value={`${stats.withFolder} / ${stats.total}`} tone="text-[var(--color-brand-primary)]" />
        <Metric icon={Gauge} label="Complete" value={`${stats.completion}%`} tone="text-emerald-500" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] pb-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <SlidersHorizontal className="h-4 w-4 text-[var(--color-text-secondary)]" />
          {pillars.map((name) => {
            const Icon = PILLAR_ICON[name];
            return (
              <button
                key={name}
                onClick={() => setPillar(name)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
                  pillar === name
                    ? "bg-[var(--color-bg-elevated)] font-medium text-[var(--color-brand-primary)]"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                }`}
              >
                {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
                {name}
              </button>
            );
          })}
        </div>
        {editable ? (
          <div className="flex items-center gap-1">
            <button onClick={addPackage} className={ghostButton}><Plus className="h-3.5 w-3.5" />Add</button>
            <label className={`${ghostButton} cursor-pointer`}>
              <History className="h-3.5 w-3.5" />
              <select
                value=""
                aria-label="Apply a roadmap template"
                onChange={(event) => chooseTemplate(event.target.value)}
                className="cursor-pointer bg-transparent outline-none"
              >
                <option value="">Apply template…</option>
                {ROADMAP_TEMPLATES.map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <span className="text-[11px] text-[var(--color-text-secondary)]">Read-only in this tenant.</span>
        )}
      </div>

      {notice ? (
        <p className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] px-3 py-2 text-[11px] text-[var(--color-text-secondary)]">
          {notice}
        </p>
      ) : null}

      {visible.length === 0 ? <EmptyRoadmap editable={editable} onApply={chooseTemplate} /> : null}

      {visible.length && view === "wbs" ? (
        <WbsTable items={visible} onDelete={setPendingDelete} deletable={deletable} onChange={refresh} />
      ) : null}
      {visible.length && view === "kanban" ? <KanbanBoard items={visible} /> : null}
      {visible.length && view === "gantt" ? <Timeline items={visible} span={span} /> : null}

      {pendingDelete ? (
        <ConfirmDelete
          subject={pendingDelete.subject}
          detail="Deletes the project and everything it owns — files, runs, and review state."
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * Shown when a tenant has no work packages. A fresh installation starts here —
 * templates are generic structures, so nothing from a previous owner's plan is
 * ever pre-loaded.
 */
function EmptyRoadmap({ editable, onApply }) {
  return (
    <div className={`space-y-4 p-8 text-center ${card}`}>
      <Target className="mx-auto h-8 w-8 text-[var(--color-text-secondary)]" />
      <div>
        <h2 className="text-sm font-semibold">This roadmap is empty</h2>
        <p className="mx-auto mt-1 max-w-md text-xs text-[var(--color-text-secondary)]">
          {editable
            ? "Start from a template and rename everything to suit, or add work packages one at a time."
            : "No work packages yet, and you have read-only access to this tenant."}
        </p>
      </div>
      {editable ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {ROADMAP_TEMPLATES.map((template) => (
            <button
              key={template.id}
              onClick={() => onApply(template.id)}
              title={template.description}
              className="rounded-md border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs font-medium hover:border-[var(--color-brand-primary)]"
            >
              {template.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Metric({ icon: Icon, label, value, tone }) {
  return (
    <div className={`p-4 ${card}`}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-secondary)]">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold ${tone}`}>{value}</div>
    </div>
  );
}

function WbsTable({ items, onDelete, deletable, onChange }) {
  return (
    <div className={`overflow-x-auto ${card}`}>
      <table className="w-full text-left text-xs">
        <thead className="border-b border-[var(--color-border-subtle)] text-[10px] uppercase tracking-wider text-[var(--color-text-secondary)]">
          {/* Every column shrinks to its content except the work package itself,
              which takes the remaining width so long subjects stay readable. */}
          <tr>
            <th className="w-full min-w-[16rem] px-4 py-3">Work package</th>
            <th className="w-px whitespace-nowrap px-4 py-3">Status</th>
            <th className="w-px whitespace-nowrap px-4 py-3">Priority</th>
            <th className="w-px whitespace-nowrap px-4 py-3">Schedule</th>
            <th className="w-px whitespace-nowrap px-4 py-3 text-right">Effort</th>
            <th className="w-px px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border-subtle)]">
          {items.map((item) => (
            <tr key={item.id} className="align-top hover:bg-[var(--color-bg-elevated)]">
              <td className="px-4 py-3">
                <div className="flex items-start gap-1.5" style={{ paddingLeft: `${item.depth * 14}px` }}>
                  {item.depth > 0 ? <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-[var(--color-text-secondary)]" /> : null}
                  <TypeSelect item={item} />
                  <div className="min-w-0">
                    <input
                      value={item.subject}
                      onChange={(event) => updateWorkPackage(item.id, { subject: event.target.value })}
                      className="w-full bg-transparent font-semibold text-[var(--color-text-primary)] outline-none focus:underline"
                    />
                    <div className="mt-0.5 text-[11px] text-[var(--color-text-secondary)]">{item.description}</div>
                    {item.orphaned ? (
                      <div className="mt-0.5 text-[10px]" style={{ color: "rgb(var(--state-caution-rgb))" }}>
                        Parent missing — shown at root.
                      </div>
                    ) : null}
                    <div className="mt-1.5">
                      <FolderCell item={item} onChange={onChange} />
                    </div>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3"><StatusSelect item={item} /></td>
              <td className="px-4 py-3">
                <select
                  value={item.priority}
                  onChange={(event) => updateWorkPackage(item.id, { priority: event.target.value })}
                  style={priorityChip(item.priority)}
                  className={`${control} border`}
                >
                  {WORK_PRIORITIES.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1 font-mono text-[11px] text-[var(--color-text-secondary)]">
                  <input
                    value={item.start}
                    placeholder="2026-Q3"
                    onChange={(event) => updateWorkPackage(item.id, { start: event.target.value })}
                    className={`${control} w-20`}
                  />
                  <span>→</span>
                  <input
                    value={item.end}
                    placeholder="2027-Q4"
                    onChange={(event) => updateWorkPackage(item.id, { end: event.target.value })}
                    className={`${control} w-20`}
                  />
                </div>
              </td>
              <td className="px-4 py-3 text-right">
                <input
                  type="number"
                  min="0"
                  value={item.hours}
                  onChange={(event) => updateWorkPackage(item.id, { hours: event.target.value })}
                  className={`${control} w-20 text-right font-mono`}
                />
              </td>
              <td className="px-4 py-3">
                {deletable ? (
                  <button
                    onClick={() => onDelete(item)}
                    title="Delete permanently — requires password confirmation"
                    className="rounded p-1 text-[var(--color-text-secondary)] hover:text-[rgb(var(--state-danger-rgb))]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The folder that belongs to this work package. Because the row is the project,
 * this attaches directly rather than pointing at a separate record.
 */
function FolderCell({ item, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const attach = async () => {
    setBusy(true);
    setError("");
    const result = await attachFolderToProject(item.id);
    setBusy(false);
    if (!result.ok && result.error) setError(result.error);
    onChange?.();
  };

  const detach = async () => {
    await detachFolderFromProject(item.id);
    onChange?.();
  };

  if (item.localFolder) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-secondary)]">
        <FolderOpen className="h-3 w-3 shrink-0 text-[var(--color-brand-primary)]" />
        <button
          onClick={() => setActiveProject(item.id)}
          title="Open this project"
          className="max-w-[220px] truncate font-medium text-[var(--color-text-primary)] hover:underline"
        >
          {item.localFolder.name}
        </button>
        <span>· {item.localFolder.fileCount} files</span>
        {/* Detaching only unlinks, so it stays ungated. */}
        <button onClick={detach} aria-label="Detach folder" className="rounded p-0.5 hover:text-[rgb(var(--state-danger-rgb))]">
          <Unlink className="h-3 w-3" />
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <button onClick={attach} disabled={busy} className="flex items-center gap-1 text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50">
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderPlus className="h-3 w-3" />}
        Attach folder
      </button>
      {error ? <span className="text-[10px]" style={{ color: "rgb(var(--state-caution-rgb))" }}>{error}</span> : null}
    </div>
  );
}

/**
 * Type shown as its icon, with an invisible select laid over it. Keeps the tree
 * column compact while still letting a new package become a Phase or Milestone
 * rather than being stuck as a Task.
 */
function TypeSelect({ item }) {
  const Icon = TYPE_ICON[item.type] || CircleDot;
  return (
    <span className="relative mt-0.5 inline-flex shrink-0 items-center" title={`Type: ${item.type}`}>
      <Icon className="h-3.5 w-3.5 text-[var(--color-text-secondary)]" />
      <select
        value={item.type}
        aria-label={`Type of ${item.subject}`}
        onChange={(event) => updateWorkPackage(item.id, { type: event.target.value })}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {WORK_TYPES.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
    </span>
  );
}

function StatusSelect({ item }) {
  const Icon = STATUS_ICON[item.status] || CircleDashed;
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: statusColor(item.status) }} />
      <select
        value={item.status}
        onChange={(event) => updateWorkPackage(item.id, { status: event.target.value })}
        className={control}
      >
        {WORK_STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABELS[value] || value}</option>)}
      </select>
    </div>
  );
}

function KanbanBoard({ items }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-5">
      {WORK_STATUSES.map((status) => {
        const column = items.filter((item) => item.status === status);
        const Icon = STATUS_ICON[status];
        return (
          <div key={status} className={`space-y-3 p-4 ${card}`}>
            <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] pb-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <Icon className="h-4 w-4" style={{ color: statusColor(status) }} />
                {STATUS_LABELS[status] || status}
              </h3>
              <span className="rounded bg-[var(--color-bg-elevated)] px-2 py-0.5 font-mono text-xs text-[var(--color-text-secondary)]">
                {column.length}
              </span>
            </div>
            <div className="space-y-3">
              {column.map((item) => (
                <article key={item.id} className="space-y-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[10px] text-[var(--color-text-secondary)]">{item.pillar}</span>
                    <span style={priorityChip(item.priority)} className="shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium">
                      {item.priority}
                    </span>
                  </div>
                  <h4 className="text-xs font-semibold leading-snug">{item.subject}</h4>
                  <div className="flex items-center justify-between border-t border-[var(--color-border-subtle)] pt-2 text-[10px] text-[var(--color-text-secondary)]">
                    <span className="truncate">{item.localFolder ? item.localFolder.name : "No folder"}</span>
                    <span className="font-mono">{item.hours}h</span>
                  </div>
                </article>
              ))}
              {column.length === 0 ? <p className="text-[11px] text-[var(--color-text-secondary)]">Nothing here.</p> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Timeline({ items, span }) {
  if (!span) {
    return (
      <div className={`p-6 text-sm text-[var(--color-text-secondary)] ${card}`}>
        No work package has a valid schedule yet. Set quarters as <span className="font-mono">YYYY-Q1</span> to draw the timeline.
      </div>
    );
  }

  // Year ticks across the real span, so bar position encodes schedule rather
  // than priority. A package missing a schedule is listed without a bar.
  const startYear = Math.floor(span.from / 4);
  const endYear = Math.floor(span.to / 4);
  const years = Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index);

  return (
    <div className={`space-y-4 p-5 ${card}`}>
      <div className="flex border-b border-[var(--color-border-subtle)] pb-2 text-[10px] font-medium text-[var(--color-text-secondary)]">
        {years.map((year) => (
          <span key={year} className="shrink-0" style={{ width: `${(4 / span.quarters) * 100}%` }}>{year}</span>
        ))}
      </div>

      <div className="space-y-3">
        {items.map((item) => {
          const from = quarterIndex(item.start);
          const to = quarterIndex(item.end);
          const scheduled = from !== null && to !== null && to >= from;
          const left = scheduled ? ((from - span.from) / span.quarters) * 100 : 0;
          const width = scheduled ? ((to - from + 1) / span.quarters) * 100 : 0;
          const PillarIcon = PILLAR_ICON[item.pillar] || Landmark;
          return (
            <div key={item.id} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="flex min-w-0 items-center gap-1.5">
                  <PillarIcon className="h-3 w-3 shrink-0 text-[var(--color-text-secondary)]" />
                  <span className="truncate font-medium">{item.subject}</span>
                </span>
                <span className="shrink-0 font-mono text-[10px] text-[var(--color-text-secondary)]">
                  {scheduled ? `${item.start} → ${item.end}` : "unscheduled"}
                </span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-[var(--color-bg-elevated)]">
                {scheduled ? (
                  <div
                    className="h-full rounded-full"
                    style={{
                      marginLeft: `${left}%`,
                      width: `${Math.max(width, 1.5)}%`,
                      backgroundColor: `rgb(var(${priorityToken(item.priority)}))`,
                      opacity: item.status === "done" ? 0.4 : 0.9,
                    }}
                    title={`${item.subject} · ${item.start} → ${item.end}`}
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
