import React, { useEffect, useState } from "react";
import ForestPlotStudio from "./components/ForestPlotStudio.jsx";
import AuthGate from "./components/AuthGate.jsx";
import { applyAccountToSession, currentUser } from "./engine/accounts.js";

export default function App() {
  const [account, setAccount] = useState(() => currentUser());
  const [activeView, setActiveView] = useState("Figures");
  const [activeTab, setActiveTab] = useState("VISUALIZE");

  useEffect(() => {
    if (account) applyAccountToSession(account);
  }, [account]);

  if (!account) {
    return <AuthGate onAuthed={(user) => setAccount(user)} />;
  }

  return (
    <ForestPlotStudio
      activeView={activeView}
      setActiveView={setActiveView}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
    />
  );
}
