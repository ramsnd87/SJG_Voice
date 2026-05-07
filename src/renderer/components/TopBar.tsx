import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Environment } from "../state/useEnvironment";

export function TopBar({ env }: { env: Environment }) {
  const [tts, setTts] = useState<{ ok: boolean; loaded: boolean; voiceCount: number; error?: string } | null>(null);
  const [ffmpeg, setFfmpeg] = useState<{ ok: boolean; ffmpegPath: string } | null>(null);

  async function refresh() {
    try {
      const s = await api.ttsStatus();
      const body = s.body || {};
      setTts({ ok: s.ok, loaded: Boolean(body.model_loaded), voiceCount: Number(body.voice_count || 0) });
    } catch (err: any) {
      setTts({ ok: false, loaded: false, voiceCount: 0, error: err.message });
    }
    try { setFfmpeg(await api.ffmpegStatus()); }
    catch { setFfmpeg({ ok: false, ffmpegPath: "" }); }
  }

  useEffect(() => { refresh(); const t = setInterval(refresh, 8000); return () => clearInterval(t); }, []);

  const ramLogoUrl = "/api/asset/ram-logo";

  return (
    <header className="topbar">
      <div className="topbar-left">
        <img
          src={ramLogoUrl}
          alt="RAM Software & Development"
          className="ram-logo-bug"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
        <div className="topbar-title">
          <h1>Glitch Studio Builder</h1>
          <p>Voice cloning · clip prep · cast routing</p>
        </div>
      </div>
      <div className="topbar-right">
        <div className={`chip ${tts?.ok && tts.loaded ? "chip-good" : "chip-warn"}`}>
          <span className="chip-dot" />
          TTS {tts?.ok ? (tts.loaded ? `ready · ${tts.voiceCount}` : "online · loading") : "offline"}
        </div>
        <div className={`chip ${ffmpeg?.ok ? "chip-good" : "chip-warn"}`}>
          <span className="chip-dot" />
          ffmpeg {ffmpeg?.ok ? "ready" : "missing"}
        </div>
        <div className="chip chip-muted">sidecar :{env.sidecarPort}</div>
      </div>
    </header>
  );
}
