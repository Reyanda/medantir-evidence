import React, { useEffect, useState } from "react";
import { artworkUrl, getBackgroundArtwork, listBackgroundArtworks, onDesignAssetsChanged } from "../engine/designAssets.js";

export default function AppAmbient({ settings }) {
  const [, force] = useState(0);
  // A newly added image must appear without a reload, so track registry changes.
  useEffect(() => onDesignAssetsChanged(() => force((value) => value + 1)), []);

  const artwork = getBackgroundArtwork(settings?.backgroundArt) || listBackgroundArtworks()[0];
  const url = artworkUrl(artwork);
  return (
    <div className="app-ambient" aria-hidden="true" style={{ "--background-art-opacity": settings?.backgroundArtOpacity ?? 0.55 }}>
      {url ? <span className="app-ambient__art" style={{ backgroundImage: `url("${encodeURI(url)}")` }} /> : null}
      <span className="app-ambient__field app-ambient__field--one" />
      <span className="app-ambient__field app-ambient__field--two" />
      <span className="app-ambient__field app-ambient__field--three" />
      <span className="app-ambient__field app-ambient__field--four" />
      <span className="app-ambient__grain" />
    </div>
  );
}
