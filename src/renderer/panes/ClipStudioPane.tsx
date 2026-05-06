import React, { useState } from "react";
import { api } from "../lib/api";

export function ClipStudioPane() {
  const [mediaPath, setMediaPath] = useState("");
  const [start, setStart] = useState("0");
  const [duration, setDuration] = useState("");
  const [outName, setOutName] = useState("");
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<{ clipPath: string; ffmpegPath: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pickFile() {
    if (!window.gsb) return;
    const p = await window.gsb.pickFile({
      filters: [
        { name: "Audio/Video", extensions: ["wav", "mp3", "flac", "m4a", "ogg", "mp4", "mov", "mkv", "avi", "webm"] },
      ],
    });
    if (p) {
      setMediaPath(p);
      if (!outName) {
        const stem = p.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") || "clip";
        setOutName(stem);
      }
    }
  }

  async function extract() {
    setWorking(true); setError(null); setResult(null);
    try {
      const r = await api.extractClip({
        mediaPath,
        startSec: Number(start) || 0,
        durationSec: Number(duration) || 0,
        outName: outName || undefined,
      });
      setResult({ clipPath: r.clipPath, ffmpegPath: r.ffmpegPath });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="pane clip-studio">
      <div className="pane-header">
        <h2>Clip Studio</h2>
        <p>Trim a slice of any audio/video file into a clean 24 kHz mono WAV. Output lands in the project's <code>data/clips/</code> folder — nothing else is touched.</p>
      </div>

      <section className="card">
        <h3>Source media</h3>
        <div className="row">
          <input
            type="text"
            value={mediaPath}
            onChange={(e) => setMediaPath(e.target.value)}
            placeholder="C:\path\to\source.mp4 or .mp3"
            className="input-wide"
          />
          <button type="button" className="btn btn-ghost" onClick={pickFile}>Browse…</button>
        </div>
      </section>

      <section className="card">
        <h3>Trim</h3>
        <div className="row">
          <label className="field">
            <span>Start (sec)</span>
            <input type="number" min={0} step={0.1} value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="field">
            <span>Duration (sec, blank = to end)</span>
            <input type="number" min={0} step={0.1} value={duration} onChange={(e) => setDuration(e.target.value)} />
          </label>
          <label className="field">
            <span>Output name</span>
            <input type="text" value={outName} onChange={(e) => setOutName(e.target.value)} placeholder="clip-name" />
          </label>
        </div>
        <div className="row">
          <button type="button" className="btn btn-primary" disabled={!mediaPath || working} onClick={extract}>
            {working ? "Running ffmpeg..." : "Extract WAV"}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {result && (
          <div className="result">
            <p>Clip ready:</p>
            <code className="path mono">{result.clipPath}</code>
            <p className="muted">ffmpeg: {result.ffmpegPath}</p>
          </div>
        )}
      </section>

      <section className="card hint">
        <h3>What this is for</h3>
        <p>Voice cloning works best from a clean 10–60s reference. Use this to grab the right slice of a long recording before sending it to EnginSam TTS as a new voice profile.</p>
      </section>
    </div>
  );
}
