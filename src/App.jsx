import React, { useState, useEffect } from "react";
import ForestPlotStudio from "./components/ForestPlotStudio.jsx";

const VIEW_MAP = {
  "type": { view: "ReviewType", tab: "TYPE" },
  "reviewtype": { view: "ReviewType", tab: "TYPE" },
  "question": { view: "Question", tab: "QUESTION" },
  "protocols": { view: "Protocols", tab: "BUILD" },
  "search": { view: "Search", tab: "ANALYZE" },
  "screening": { view: "Screening", tab: "ANALYZE" },
  "extraction": { view: "Extraction", tab: "SYNTHESIZE" },
  "appraisal": { view: "Appraisal", tab: "SYNTHESIZE" },
  "triangulation": { view: "Triangulation", tab: "SYNTHESIZE" },
  "synthesis": { view: "Synthesis", tab: "SYNTHESIZE" },
  "figures": { view: "Figures", tab: "VISUALIZE" },
  "map": { view: "Evidence Map", tab: "VISUALIZE" },
  "reports": { view: "Reports", tab: "PUBLISH" },
  "launch": { view: "Launch", tab: "TYPE" },
  "overview": { view: "Overview", tab: "TYPE" },
  "settings": { view: "Settings", tab: "BUILD" },
};

function getInitialView() {
  const hash = window.location.hash.replace(/^#\/?/, "").toLowerCase();
  if (hash && VIEW_MAP[hash]) {
    return VIEW_MAP[hash];
  }
  return { view: "ReviewType", tab: "TYPE" };
}

export default function App() {
  const initial = getInitialView();
  const [activeView, setActiveView] = useState(initial.view);
  const [activeTab, setActiveTab] = useState(initial.tab);

  useEffect(() => {
    const onHashChange = () => {
      const h = window.location.hash.replace(/^#\/?/, "").toLowerCase();
      if (h && VIEW_MAP[h]) {
        setActiveView(VIEW_MAP[h].view);
        setActiveTab(VIEW_MAP[h].tab);
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const handleSetActiveView = (view) => {
    setActiveView(view);
    // Find matching hash
    const entry = Object.entries(VIEW_MAP).find(([, v]) => v.view === view);
    if (entry) {
      window.location.hash = entry[0];
    }
  };

  return (
    <ForestPlotStudio
      activeView={activeView}
      setActiveView={handleSetActiveView}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
    />
  );
}
