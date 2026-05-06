import React from "react";

export type PaneId = "voiceLab" | "voiceWorkshop" | "library" | "clipStudio" | "castRouting" | "createPodcast" | "threeD";

const ITEMS: { id: PaneId; label: string; subtitle: string; glyph: string }[] = [
  { id: "voiceLab", label: "Voice Lab", subtitle: "Clone & tune", glyph: "◈" },
  { id: "voiceWorkshop", label: "Voice Workshop", subtitle: "Identify & adjust", glyph: "✦" },
  { id: "library", label: "Voice Library", subtitle: "All voices", glyph: "❖" },
  { id: "clipStudio", label: "Clip Studio", subtitle: "Trim references", glyph: "▶︎" },
  { id: "castRouting", label: "Cast Routing", subtitle: "Voice → speaker", glyph: "⌘" },
  { id: "createPodcast", label: "Create Podcast", subtitle: "Cast · script · handoff", glyph: "★" },
  { id: "threeD", label: "3D Builder", subtitle: "Image → 3D queue", glyph: "◆" },
];

export function Sidebar({ active, onSelect }: { active: PaneId; onSelect: (id: PaneId) => void }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark">GS</div>
        <div className="brand-text">
          <strong>Glitch Studio</strong>
          <span>Builder</span>
        </div>
      </div>
      <nav className="sidebar-nav">
        {ITEMS.map((item) => (
          <button
            key={item.id}
            className={`nav-item${active === item.id ? " is-active" : ""}`}
            onClick={() => onSelect(item.id)}
            type="button"
          >
            <span className="nav-glyph">{item.glyph}</span>
            <span className="nav-text">
              <strong>{item.label}</strong>
              <em>{item.subtitle}</em>
            </span>
          </button>
        ))}
      </nav>
      <footer className="sidebar-footer">
        <p>Standalone build · isolated from SAM_PODCAST &amp; EnginSam</p>
      </footer>
    </aside>
  );
}
