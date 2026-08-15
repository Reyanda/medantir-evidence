import React, { useState, useEffect } from "react";
import ForestPlotStudio from "./components/ForestPlotStudio.jsx";
import "./styles/workbench.css";

export default function App() {
  const getInitialView = () => {
    const hash = window.location.hash.toLowerCase().replace("#", "");
    if (hash === "type" || hash === "reviewtype") return { view: "ReviewType", tab: "TYPE" };
    if (hash === "question" || hash === "questions") return { view: "Question", tab: "QUESTION" };
    if (hash === "protocols" || hash === "strategy") return { view: "Protocols", tab: "BUILD" };
    if (hash === "search" || hash === "retrieval") return { view: "Search", tab: "ANALYZE" };
    if (hash === "screening") return { view: "Screening", tab: "ANALYZE" };
    if (hash === "extraction") return { view: "Extraction", tab: "SYNTHESIZE" };
    if (hash === "appraisal" || hash === "rob") return { view: "Appraisal", tab: "SYNTHESIZE" };
    if (hash === "triangulation") return { view: "Triangulation", tab: "SYNTHESIZE" };
    if (hash === "synthesis" || hash === "meta") return { view: "Synthesis", tab: "SYNTHESIZE" };
    if (hash === "figures" || hash === "forest") return { view: "Figures", tab: "VISUALIZE" };
    if (hash === "evidencemap" || hash === "map") return { view: "Evidence Map", tab: "VISUALIZE" };
    if (hash === "reports" || hash === "prisma") return { view: "Reports", tab: "PUBLISH" };
    return { view: "ReviewType", tab: "TYPE" };
  };

  const initial = getInitialView();
  const [activeView, setActiveView] = useState(initial.view);
  const [activeTab, setActiveTab] = useState(initial.tab);

  useEffect(() => {
    const handleHashChange = () => {
      const target = getInitialView();
      setActiveView(target.view);
      setActiveTab(target.tab);
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  return (
    <ForestPlotStudio
      activeView={activeView}
      setActiveView={setActiveView}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
    />
  );
}
