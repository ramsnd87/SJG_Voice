import React, { useEffect, useState } from "react";
import { Sidebar, type PaneId } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { VoiceLabPane } from "./panes/VoiceLabPane";
import { VoiceWorkshopPane } from "./panes/VoiceWorkshopPane";
import { LibraryPane } from "./panes/LibraryPane";
import { ClipStudioPane } from "./panes/ClipStudioPane";
import { CastRoutingPane } from "./panes/CastRoutingPane";
import { CreatePodcastPane } from "./panes/CreatePodcastPane";
import { ThreeDBuilderPane } from "./panes/ThreeDBuilderPane";
import { useEnvironment } from "./state/useEnvironment";

export function App() {
  const [pane, setPane] = useState<PaneId>("voiceLab");
  const env = useEnvironment();

  useEffect(() => {
    document.title = `Glitch Studio Builder${env.appVersion ? ` · v${env.appVersion}` : ""}`;
  }, [env.appVersion]);

  return (
    <div className="app-shell">
      <Sidebar active={pane} onSelect={setPane} />
      <div className="main-column">
        <TopBar env={env} />
        <main className="pane-host">
          {pane === "voiceLab" && <VoiceLabPane />}
          {pane === "voiceWorkshop" && <VoiceWorkshopPane />}
          {pane === "library" && <LibraryPane />}
          {pane === "clipStudio" && <ClipStudioPane />}
          {pane === "castRouting" && <CastRoutingPane />}
          {pane === "createPodcast" && <CreatePodcastPane />}
          {pane === "threeD" && <ThreeDBuilderPane />}
        </main>
      </div>
    </div>
  );
}
