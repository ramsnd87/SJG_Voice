import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, audioFromBase64, FX_DEFAULTS, type MoodFx, type MoodPreset, type MoodValue } from "../lib/api";
import { useAudioFx } from "../lib/useAudioFx";

type SaveState = "idle" | "saving" | "saved" | "error";
type PreviewState = "idle" | "loading" | "ready" | "error";

export function MoodLibrarySubpane() {
  const [presets, setPresets] = useState<MoodPreset[]>([]);
  const [voices, setVoices] = useState<{ slug: string; displayName: string }[]>([]);
  const [voiceSlug, setVoiceSlug] = useState<string>("");
  const [selectedMood, setSelectedMood] = useState<string | null>(null);
  const [overrideMap, setOverrideMap] = useState<Record<string, boolean>>({});
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.voiceMoods().then((r) => {
      if (cancelled) return;
      setPresets(r.moods);
      setVoices(r.presetVoices);
      if (r.presetVoices.length && !voiceSlug) setVoiceSlug(r.presetVoices[0].slug);
    }).catch((err) => { if (!cancelled) setBootError(err.message); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!voiceSlug || presets.length === 0) return;
    let cancelled = false;
    (async () => {
      const map: Record<string, boolean> = {};
      await Promise.all(presets.map(async (p) => {
        try {
          const r = await api.loadMood(voiceSlug, p.id);
          map[p.id] = r.mood.isOverridden;
        } catch { map[p.id] = false; }
      }));
      if (!cancelled) setOverrideMap(map);
    })();
    return () => { cancelled = true; };
  }, [voiceSlug, presets]);

  const activeVoice = useMemo(() => voices.find((v) => v.slug === voiceSlug) || null, [voices, voiceSlug]);

  return (
    <div className="mood-library">
      <section className="card mood-header">
        <div>
          <h3>Prebuilt mood presets</h3>
          <p className="muted">20 curated moods × 3 prebuilt voices. Each mood has its own sample line and synthesis dials. Edit and save per-voice — revert any mood back to the original at any time.</p>
        </div>
        <div className="speaker-chips" role="tablist">
          {voices.map((v) => (
            <button
              key={v.slug}
              type="button"
              role="tab"
              aria-selected={v.slug === voiceSlug}
              className={`speaker-chip${v.slug === voiceSlug ? " is-active" : ""}`}
              onClick={() => { setVoiceSlug(v.slug); setSelectedMood(null); }}
            >
              {v.displayName}
            </button>
          ))}
        </div>
        {bootError && <p className="error">{bootError}</p>}
      </section>

      <div className="mood-grid">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`mood-card${selectedMood === p.id ? " is-active" : ""}${overrideMap[p.id] ? " is-customised" : ""}`}
            onClick={() => setSelectedMood(p.id === selectedMood ? null : p.id)}
          >
            <div className="mood-card-glyph">{p.emoji}</div>
            <div className="mood-card-body">
              <strong>{p.label}</strong>
              <em>{p.description}</em>
              <div className="mood-card-meta">
                <span>ex {p.exaggeration.toFixed(2)}</span>
                <span>cfg {p.cfg_weight.toFixed(2)}</span>
                {overrideMap[p.id] && <span className="tag tag-good">customised</span>}
              </div>
            </div>
          </button>
        ))}
      </div>

      {selectedMood && voiceSlug && activeVoice && (
        <MoodEditor
          key={`${voiceSlug}::${selectedMood}`}
          voiceSlug={voiceSlug}
          voiceLabel={activeVoice.displayName}
          moodId={selectedMood}
          onClose={() => setSelectedMood(null)}
          onOverrideChanged={(isOverridden) => setOverrideMap((m) => ({ ...m, [selectedMood]: isOverridden }))}
        />
      )}
    </div>
  );
}

function MoodEditor({ voiceSlug, voiceLabel, moodId, onClose, onOverrideChanged }: {
  voiceSlug: string;
  voiceLabel: string;
  moodId: string;
  onClose: () => void;
  onOverrideChanged: (isOverridden: boolean) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [baseline, setBaseline] = useState<MoodPreset | null>(null);
  const [current, setCurrent] = useState<MoodValue | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>("idle");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useAudioFx(audioRef, current?.fx ?? FX_DEFAULTS);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setSaveError(null); setSaveState("idle"); setAudioUrl(null);
    api.loadMood(voiceSlug, moodId).then((r) => {
      if (cancelled) return;
      setBaseline(r.baseline);
      setCurrent({ ...r.mood, fx: { ...FX_DEFAULTS, ...r.mood.fx } });
    }).catch((err) => { if (!cancelled) setSaveError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [voiceSlug, moodId]);

  function update<K extends keyof MoodValue>(key: K, value: MoodValue[K]) {
    setCurrent((c) => c ? { ...c, [key]: value } : c);
    setSaveState("idle"); setSaveError(null);
  }
  function updateFx<K extends keyof MoodFx>(key: K, value: MoodFx[K]) {
    setCurrent((c) => c ? { ...c, fx: { ...c.fx, [key]: value } } : c);
    setSaveState("idle"); setSaveError(null);
  }
  function resetFx() {
    setCurrent((c) => c ? { ...c, fx: { ...FX_DEFAULTS } } : c);
    setSaveState("idle"); setSaveError(null);
  }

  async function reloadFromServer() {
    setSaveError(null); setSaveState("idle");
    try {
      const r = await api.loadMood(voiceSlug, moodId);
      setCurrent(r.mood);
      onOverrideChanged(r.mood.isOverridden);
    } catch (err: any) { setSaveError(err.message); }
  }

  async function handleSave() {
    if (!current) return;
    setSaveState("saving"); setSaveError(null);
    try {
      const r = await api.saveMood(voiceSlug, moodId, {
        sampleText: current.sampleText,
        exaggeration: current.exaggeration,
        cfg_weight: current.cfg_weight,
        fx: current.fx,
        notes: current.notes,
      });
      setCurrent({ ...r.mood, fx: { ...FX_DEFAULTS, ...r.mood.fx } });
      onOverrideChanged(true);
      setSaveState("saved");
      setTimeout(() => setSaveState((s) => s === "saved" ? "idle" : s), 2000);
    } catch (err: any) {
      setSaveError(err.message);
      setSaveState("error");
    }
  }

  async function handleRevertEdits() {
    await reloadFromServer();
  }

  async function handleResetToBaseline() {
    if (!confirm(`Reset "${current?.label}" for ${voiceLabel} back to the original preset? Your saved override will be deleted.`)) return;
    setSaveError(null);
    try {
      await api.revertMood(voiceSlug, moodId);
      await reloadFromServer();
    } catch (err: any) { setSaveError(err.message); }
  }

  async function handlePreview() {
    if (!current) return;
    setPreviewState("loading"); setPreviewError(null); setAudioUrl(null);
    try {
      const result = await api.speak(voiceSlug, current.sampleText, {
        exaggeration: current.exaggeration,
        cfg_weight: current.cfg_weight,
      });
      if (!result.audio_base64) throw new Error("No audio returned.");
      const url = audioFromBase64(result.audio_base64);
      setAudioUrl(url);
      setPreviewState("ready");
      setTimeout(() => audioRef.current?.play().catch(() => undefined), 50);
    } catch (err: any) {
      setPreviewError(err.message);
      setPreviewState("error");
    }
  }

  if (loading || !current || !baseline) {
    return <section className="card mood-editor"><p className="muted">Loading {moodId}…</p></section>;
  }

  // dirty detection no longer matters at the field level — we just enable Save unconditionally;
  // Discard reloads from server.
  const dirty = true;

  return (
    <section className="card mood-editor">
      <header className="mood-editor-header">
        <div className="mood-editor-title">
          <span className="mood-editor-glyph">{baseline.emoji}</span>
          <div>
            <h3>{baseline.label} <span className="mood-editor-voice">· {voiceLabel}</span></h3>
            <p className="muted small">{baseline.description}</p>
          </div>
        </div>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
      </header>

      <div className="fx-section">
        <div className="fx-section-head"><h4>Synthesis</h4><span className="muted small">EnginSam Chatterbox engine</span></div>
        <div className="form-grid form-grid-sliders">
          <SliderField label="Exaggeration" hint={`baseline ${baseline.exaggeration.toFixed(2)}`}
            value={current.exaggeration} min={0.1} max={1.5} step={0.05}
            onChange={(v) => update("exaggeration", v)} />
          <SliderField label="cfg_weight" hint={`baseline ${baseline.cfg_weight.toFixed(2)}`}
            value={current.cfg_weight} min={0.1} max={1.0} step={0.05}
            onChange={(v) => update("cfg_weight", v)} />
        </div>
      </div>

      <div className="fx-section">
        <div className="fx-section-head">
          <h4>Sound design</h4>
          <span className="muted small">live, browser-side · click <strong>Preview voice</strong> after editing the sample line</span>
          <button type="button" className="btn btn-ghost btn-mini" onClick={resetFx}>Reset FX to flat</button>
        </div>

        <div className="fx-group">
          <h5>Playback</h5>
          <div className="form-grid form-grid-sliders">
            <SliderField label="Rate" hint="speed of playback"
              value={current.fx.rate} min={0.5} max={1.5} step={0.05} format="x"
              onChange={(v) => updateFx("rate", v)} />
            <SliderField label="Volume" hint="master gain"
              value={current.fx.volume} min={0} max={2} step={0.05} format="x"
              onChange={(v) => updateFx("volume", v)} />
          </div>
        </div>

        <div className="fx-group">
          <h5>EQ</h5>
          <div className="form-grid form-grid-sliders form-grid-3">
            <SliderField label="Bass" hint="low shelf @ 250 Hz"
              value={current.fx.bass} min={-12} max={12} step={0.5} format="db"
              onChange={(v) => updateFx("bass", v)} />
            <SliderField label="Presence" hint="peaking @ 2 kHz"
              value={current.fx.presence} min={-12} max={12} step={0.5} format="db"
              onChange={(v) => updateFx("presence", v)} />
            <SliderField label="Treble" hint="high shelf @ 4.5 kHz"
              value={current.fx.treble} min={-12} max={12} step={0.5} format="db"
              onChange={(v) => updateFx("treble", v)} />
          </div>
        </div>

        <div className="fx-group">
          <h5>Color</h5>
          <div className="form-grid form-grid-sliders form-grid-3">
            <SliderField label="Drive" hint="waveshaper saturation"
              value={current.fx.drive} min={0} max={1} step={0.02}
              onChange={(v) => updateFx("drive", v)} />
            <SliderField label="Reverb mix" hint="convolver wet/dry"
              value={current.fx.reverbMix} min={0} max={1} step={0.02}
              onChange={(v) => updateFx("reverbMix", v)} />
            <SliderField label="Compression" hint="one-knob (0=off, 1=heavy)"
              value={current.fx.compression} min={0} max={1} step={0.02}
              onChange={(v) => updateFx("compression", v)} />
          </div>
        </div>

        <div className="fx-group">
          <h5>Echo &amp; Stereo</h5>
          <div className="form-grid form-grid-sliders form-grid-3">
            <SliderField label="Echo mix" hint="delay wet level"
              value={current.fx.delayMix} min={0} max={1} step={0.02}
              onChange={(v) => updateFx("delayMix", v)} />
            <SliderField label="Echo time" hint="delay length"
              value={current.fx.delayTime} min={40} max={800} step={5} format="ms"
              onChange={(v) => updateFx("delayTime", v)} />
            <SliderField label="Stereo pan" hint="-1 left · 0 center · +1 right"
              value={current.fx.stereo} min={-1} max={1} step={0.05}
              onChange={(v) => updateFx("stereo", v)} />
          </div>
        </div>
      </div>

      <label className="field">
        <span>Sample line</span>
        <textarea rows={3} value={current.sampleText} onChange={(e) => update("sampleText", e.target.value)} />
      </label>

      <label className="field">
        <span>Notes (optional)</span>
        <textarea rows={2} value={current.notes} onChange={(e) => update("notes", e.target.value)} placeholder="What this mood is for in your show / scene." />
      </label>

      <div className="mood-actions">
        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saveState === "saving"}>
          {saveState === "saving" ? "Saving…" : "Save changes"}
        </button>
        <button type="button" className="btn" onClick={handleRevertEdits} disabled={!dirty}>
          Discard edits
        </button>
        {current.isOverridden && (
          <button type="button" className="btn btn-ghost" onClick={handleResetToBaseline}>Reset to baseline</button>
        )}
        <button type="button" className="btn" onClick={handlePreview} disabled={previewState === "loading"}>
          {previewState === "loading" ? "Synthesizing…" : "Preview voice"}
        </button>
        {saveState === "saved" && <span className="tag tag-good">Saved</span>}
        {current.isOverridden && saveState !== "saved" && <span className="tag">Customised</span>}
        {!current.isOverridden && saveState !== "saved" && <span className="tag">Baseline</span>}
        {current.updatedAt && <span className="muted small">Last saved {new Date(current.updatedAt).toLocaleString()}</span>}
      </div>

      {saveError && <p className="error">{saveError}</p>}
      {previewError && <p className="error">{previewError}</p>}
      {audioUrl && <audio ref={audioRef} controls src={audioUrl} className="audio-player" />}
    </section>
  );
}

type SliderFormat = "default" | "x" | "db" | "ms";
function formatValue(v: number, fmt: SliderFormat = "default"): string {
  if (fmt === "x") return `${v.toFixed(2)}x`;
  if (fmt === "db") return `${v >= 0 ? "+" : ""}${v.toFixed(1)} dB`;
  if (fmt === "ms") return `${Math.round(v)} ms`;
  return v.toFixed(2);
}
function SliderField({ label, hint, value, min, max, step, onChange, format }: { label: string; hint?: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: SliderFormat }) {
  return (
    <label className="slider-field">
      <span className="slider-label">
        <strong>{label}</strong>
        <em>{formatValue(value, format)}</em>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <span className="slider-hint">{hint}</span>}
    </label>
  );
}
