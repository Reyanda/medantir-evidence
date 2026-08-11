import React from "react";

// Reusable shimmer block. Uses Tailwind's animate-pulse, which the global
// prefers-reduced-motion rule (index.css) already neutralises for those users.
export function Skeleton({ className = "" }) {
  return <div className={`animate-pulse rounded bg-zinc-200/70 dark:bg-zinc-800/70 ${className}`} />;
}

// Content-shaped placeholder shown while a lazy tab (or its data) loads — mirrors
// the common tab layout (title + subtitle → stat row → main panel) so the page
// feels like it's assembling rather than spinning on a blank screen.
export function TabSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-busy="true" aria-label="Loading view">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Skeleton className="h-64 lg:col-span-2" />
        <Skeleton className="h-64" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

// Empty-state placeholder — a consistent "nothing here yet" across tabs.
export function EmptyState({ icon: Icon, title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-4">
      {Icon && <Icon className="h-8 w-8 text-zinc-300 dark:text-zinc-600 mb-3" />}
      <div className="text-sm font-medium text-zinc-600 dark:text-zinc-300">{title}</div>
      {hint && <div className="text-xs text-zinc-400 mt-1 max-w-sm">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
