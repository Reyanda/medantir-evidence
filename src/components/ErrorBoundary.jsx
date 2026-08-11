import React from "react";
import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";

// Per-view error boundary. A crash (or a failed lazy-chunk load after a fresh
// deploy) in one tab is contained here instead of white-screening the whole app;
// the shell (sidebar/header/composer) stays usable. `resetKey` (the active tab)
// clears the error automatically when the user navigates elsewhere.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    // A chunk that 404s after a redeploy throws a dynamic-import error — offer a
    // hard reload (fetches the current asset manifest) as the fix.
    const isChunk = /dynamically imported module|Failed to fetch|Loading chunk|import\(\)/i.test(
      String(error?.message || "")
    );

    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-8 max-w-2xl">
        <div className="flex items-center gap-2 text-rose-500 font-medium">
          <AlertTriangle className="h-5 w-5" /> This view hit an error
        </div>
        <p className="text-sm text-zinc-500 mt-2">
          {isChunk
            ? "The app was updated since this page loaded. Reload to get the latest version."
            : "The rest of the platform is still working — you can switch to another engine or retry."}
        </p>
        <div className="text-[11px] font-mono text-zinc-400 mt-2 break-words">
          {String(error?.message || error)}
        </div>
        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={() => this.setState({ error: null })}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Retry
          </button>
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Reload app
          </button>
        </div>
      </div>
    );
  }
}
