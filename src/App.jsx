import React, { useEffect, useState } from "react";
import ForestPlotStudio from "./components/ForestPlotStudio.jsx";
import AuthGate from "./components/AuthGate.jsx";
import SemanticEvidenceWorkbench from "./components/SemanticEvidenceWorkbench.jsx";
import { applyAccountToSession, currentUser } from "./engine/accounts.js";

const SEMANTIC_HASH = "#semantic-evidence";

export default function App() {
  const [account, setAccount] = useState(() => currentUser());
  const [activeView, setActiveView] = useState("Figures");
  const [activeTab, setActiveTab] = useState("VISUALIZE");
  const [workspace, setWorkspace] = useState(() => window.location.hash === SEMANTIC_HASH ? "semantic" : "review");

  useEffect(() => {
    if (account) applyAccountToSession(account);
  }, [account]);

  useEffect(() => {
    const sync = () => setWorkspace(window.location.hash === SEMANTIC_HASH ? "semantic" : "review");
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  if (!account) {
    return <AuthGate onAuthed={(user) => setAccount(user)} />;
  }

  if (workspace === "semantic") {
    return <SemanticEvidenceWorkbench onBack={() => { window.location.hash = ""; setWorkspace("review"); }} />;
  }

  return (
    <>
      <ForestPlotStudio
        activeView={activeView}
        setActiveView={setActiveView}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />
      <button
        className="semantic-index-launch"
        onClick={() => { window.location.hash = SEMANTIC_HASH; setWorkspace("semantic"); }}
        title="Open the source-bound semantic evidence index"
      >
        Semantic evidence index
      </button>
    </>
  );
}
