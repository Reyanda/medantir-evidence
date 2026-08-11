import React, { useState } from "react";
import ForestPlotStudio from "./components/ForestPlotStudio.jsx";

export default function App() {
  const [activeView, setActiveView] = useState("Figures");
  const [activeTab, setActiveTab] = useState("VISUALIZE");

  return (
    <ForestPlotStudio
      activeView={activeView}
      setActiveView={setActiveView}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
    />
  );
}
