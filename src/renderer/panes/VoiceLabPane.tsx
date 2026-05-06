import React, { useEffect, useMemo, useState } from "react";
import { api, audioFromBase64, type VoiceProfile } from "../lib/api";

export function VoiceLabPane() {
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [text, setText] = useState("Hello. This is a test of the cloned voice — say something memorable here.");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);

  async function refresh() {
    try {
      const r = await api.voices();
      const merged = mergeRemoteAndLocal(r.local, r.remote?.body?.voices || []);
      setVoices(merged);
      if (!selectedSlug && merged.length) setSelectedSlug(merged[0].slug);
    } catch (err: any) {
      setError(err.message);
    }
  }

  useEffect(() => { refresh(); }, []);

  const selected = useMemo(() => voices.find((v) => v.slug === selectedSlug) || null, [voices, selectedSlug]);

  async function handleSpeak() {
    if (!selected) return;
    setLoading(true); setError(null); setAudioUrl(null); setDuration(null);
    try {
      const result = await api.speak(selected.slug, text);
      if (result.audio_base64) {
        setAudioUrl(audioFromBase64(result.audio_base64));
        setDuration(result.duration_s ?? null);
      } else {
        setError("TTS server returned no audio.");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pane voice-lab">
      <div className="pane-header">
        <h2>Voice Lab</h2>
        <p>Pick a cloned voice, write a line, and play it through EnginSam TTS.</p>
      </div>

      <div className="lab-grid">
        <section className="card">
          <h3>1 · Choose voice</h3>
          <div className="voice-list">
            {voices.length === 0 && <p className="muted">No voices found. Check the Library tab.</p>}
            {voices.map((v) => (
              <button
                key={v.slug}
                type="button"
                className={`voice-row${v.slug === selectedSlug ? " is-selected" : ""}`}
                onClick={() => setSelectedSlug(v.slug)}
              >
                <div className="voice-row-main">
                  <strong>{v.displayName}</strong>
                  <em>{v.slug}</em>
                </div>
                <div className="voice-row-meta">
                  {v.policy?.copyright_safe === false && <span className="tag tag-warn">IP risk</span>}
                  <span className="tag">{v.libraryRoot.includes("EnginSam") ? "engine" : "mirror"}</span>
                </div>
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-ghost" onClick={refresh}>Reload list</button>
        </section>

        <section className="card">
          <h3>2 · Test line</h3>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder="Type something for the voice to say..."
          />
          <div className="row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!selected || loading || !text.trim()}
              onClick={handleSpeak}
            >
              {loading ? "Synthesizing..." : `Speak as ${selected?.displayName || "—"}`}
            </button>
            {duration !== null && <span className="muted">{duration.toFixed(2)}s</span>}
          </div>
          {error && <p className="error">{error}</p>}
          {audioUrl && <audio controls src={audioUrl} className="audio-player" />}
        </section>

        <section className="card">
          <h3>3 · Voice details</h3>
          {!selected && <p className="muted">Select a voice to see its profile.</p>}
          {selected && (
            <dl className="kv">
              <dt>Slug</dt><dd>{selected.slug}</dd>
              <dt>Display name</dt><dd>{selected.displayName}</dd>
              <dt>Reference audio</dt><dd className="path">{selected.referenceAudio || "—"}</dd>
              <dt>Profile path</dt><dd className="path">{selected.profilePath}</dd>
              <dt>Library root</dt><dd className="path">{selected.libraryRoot}</dd>
              <dt>Created</dt><dd>{selected.createdAt || "—"}</dd>
              {selected.policy && (
                <>
                  <dt>Policy</dt>
                  <dd>
                    {selected.policy.copyright_safe === false ? "⚠ flagged" : "ok"}
                    {selected.policy.notes?.length ? (
                      <ul className="policy-notes">{selected.policy.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
                    ) : null}
                  </dd>
                </>
              )}
            </dl>
          )}
        </section>
      </div>
    </div>
  );
}

function mergeRemoteAndLocal(local: VoiceProfile[], remote: any[]): VoiceProfile[] {
  const remoteMap = new Map<string, any>();
  for (const r of remote) {
    const key = String(r?.slug || r?.name || "").toLowerCase();
    if (key) remoteMap.set(key, r);
  }
  const localKeys = new Set(local.map((l) => l.slug.toLowerCase()));
  const merged = [...local];
  for (const [key, r] of remoteMap) {
    if (!localKeys.has(key)) {
      merged.push({
        slug: key,
        name: r?.name || key,
        displayName: r?.name || key,
        description: r?.description || "",
        type: "engine-only",
        referenceAudio: "",
        profilePath: "(only in EnginSam TTS server)",
        libraryRoot: "EnginSam",
        policy: null,
        createdAt: null,
      });
    }
  }
  return merged;
}
