import React, { useEffect, useState } from "react";
import { Check, Globe, ImageOff, ImagePlus, Loader2, Search, X } from "lucide-react";
import {
  IMAGE_SOURCES, addBackgroundArtwork, listBackgroundArtworks, listCustomArtworks,
  onDesignAssetsChanged, removeBackgroundArtwork, searchImages,
} from "../engine/designAssets.js";

// Background imagery picker. Any image reachable over https can become the app's
// backdrop — pick a shipped artwork, search an open catalogue, or paste a URL.
// No design language hardcodes a picture; they all read this registry.

const input = "w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)] px-2 py-1.5 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-brand-primary)]";
const labelText = "text-[10px] font-mono text-[var(--color-text-secondary)]";

export default function ArtworkPicker({ settings, onChange }) {
  const [, force] = useState(0);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState(IMAGE_SOURCES[0].id);
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [manualUrl, setManualUrl] = useState("");
  const [showFinder, setShowFinder] = useState(false);

  useEffect(() => onDesignAssetsChanged(() => force((value) => value + 1)), []);

  const artworks = listBackgroundArtworks();
  const custom = listCustomArtworks();

  const runSearch = async (event) => {
    event?.preventDefault();
    setBusy(true);
    setStatus("");
    const outcome = await searchImages(query, { source });
    setBusy(false);
    setResults(outcome.results);
    if (!outcome.ok) setStatus(outcome.error);
    else if (!outcome.results.length) setStatus("No images matched that search.");
  };

  const apply = (asset) => {
    const added = addBackgroundArtwork(asset);
    if (!added.ok) { setStatus(added.error); return; }
    onChange({ backgroundArt: added.asset.id, background: "gallery-art" });
    setStatus(`Applied “${added.asset.name}”.`);
  };

  const addManual = (event) => {
    event.preventDefault();
    apply({ name: manualUrl.split("/").pop()?.slice(0, 60) || "Custom image", url: manualUrl.trim(), source: "Direct link" });
    setManualUrl("");
  };

  const drop = (id) => {
    const removed = removeBackgroundArtwork(id);
    if (!removed.ok) { setStatus(removed.error); return; }
    // Fall back to a shipped image when the active one is removed.
    if (settings.backgroundArt === id) onChange({ backgroundArt: listBackgroundArtworks()[0]?.id });
  };

  return (
    <div className="space-y-2 border-t pt-2" style={{ borderColor: "var(--color-border-subtle)" }}>
      <label className={`block ${labelText}`}>
        Background image
        <select
          value={settings.backgroundArt}
          onChange={(event) => onChange({ backgroundArt: event.target.value })}
          className={`mt-1 ${input}`}
        >
          {artworks.map((artwork) => (
            <option key={artwork.id} value={artwork.id}>
              {artwork.name}{artwork.artist ? ` — ${artwork.artist}` : ""}
            </option>
          ))}
        </select>
      </label>

      <label className={`block ${labelText}`}>
        <span className="flex justify-between">
          <span>Image presence</span>
          <span>{Math.round(settings.backgroundArtOpacity * 100)}%</span>
        </span>
        <input
          aria-label="Image presence"
          className="mt-1 w-full accent-[var(--color-brand-primary)]"
          type="range" min="0.08" max="0.78" step="0.01"
          value={settings.backgroundArtOpacity}
          onChange={(event) => onChange({ backgroundArtOpacity: Number(event.target.value) })}
        />
      </label>

      <button
        onClick={() => setShowFinder((value) => !value)}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-[var(--color-border-subtle)] py-1.5 text-[10px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
      >
        {showFinder ? <X className="h-3 w-3" /> : <ImagePlus className="h-3 w-3" />}
        {showFinder ? "Close image finder" : "Find or add an image"}
      </button>

      {showFinder ? (
        <div className="space-y-2">
          <form onSubmit={runSearch} className="space-y-1.5">
            <div className="flex gap-1.5">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="flag of the United States"
                className={input}
              />
              <button
                type="submit"
                disabled={busy}
                aria-label="Search images"
                className="shrink-0 rounded-md bg-[var(--color-brand-primary)] px-2.5 text-white disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              </button>
            </div>
            <label className={`flex items-center gap-1.5 ${labelText}`}>
              <Globe className="h-3 w-3" />
              <select value={source} onChange={(event) => setSource(event.target.value)} className={input}>
                {IMAGE_SOURCES.map((option) => (
                  <option key={option.id} value={option.id}>{option.name} — {option.hint}</option>
                ))}
              </select>
            </label>
            <p className="text-[9px] leading-relaxed text-[var(--color-text-secondary)]">
              Your search text is sent to the selected catalogue. Images are referenced by link, never uploaded or copied locally.
            </p>
          </form>

          {results.length ? (
            <div className="grid max-h-52 grid-cols-3 gap-1.5 overflow-y-auto">
              {results.map((result) => (
                <button
                  key={result.key}
                  onClick={() => apply(result)}
                  title={`${result.name}${result.license ? ` · ${result.license}` : ""}`}
                  className="group relative aspect-square overflow-hidden rounded-md border border-[var(--color-border-subtle)]"
                >
                  <img src={result.thumbUrl} alt={result.name} loading="lazy" className="h-full w-full object-cover" />
                  <span className="absolute inset-0 hidden items-center justify-center bg-black/50 group-hover:flex">
                    <Check className="h-4 w-4 text-white" />
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          <form onSubmit={addManual} className="flex gap-1.5">
            <input
              value={manualUrl}
              onChange={(event) => setManualUrl(event.target.value)}
              placeholder="https://…/image.jpg"
              className={input}
            />
            <button type="submit" className="shrink-0 rounded-md border border-[var(--color-border-subtle)] px-2 text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
              Add
            </button>
          </form>

          {custom.length ? (
            <div className="space-y-1">
              <div className={labelText}>Your images</div>
              {custom.map((asset) => (
                <div key={asset.id} className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-secondary)]">
                  <span className="min-w-0 flex-1 truncate" title={asset.url}>{asset.name}</span>
                  <button onClick={() => drop(asset.id)} aria-label={`Remove ${asset.name}`} className="rounded p-0.5 hover:text-[rgb(var(--state-danger-rgb))]">
                    <ImageOff className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {status ? <p className="text-[10px] text-[var(--color-text-secondary)]" role="status">{status}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
