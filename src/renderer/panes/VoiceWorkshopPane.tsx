import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, audioFromBase64, type VoiceProfile, type VoiceWorkshopProfile } from "../lib/api";
import { MoodLibrarySubpane } from "./MoodLibrarySubpane";

type SubTab = "single" | "moods";
type SaveState = "idle" | "saving" | "saved" | "error";
type PreviewState = "idle" | "loading" | "ready" | "error";

const VOICE_TYPES = [
  "character", "narrator", "host", "co-host", "guest", "antagonist",
  "creature", "robotic", "broadcaster", "monologue", "tutorial-vo", "other",
];
const ARCHETYPES = [
  "rugged frontier", "cyber/synth", "dramatic villain", "calm narrator",
  "playful sidekick", "stoic mentor", "documentary host", "rallying leader",
  "weary traveler", "trickster", "machine intelligence", "noir detective",
];
const TONE_HINTS = [
  "rugged western storyteller", "calm trail-guide confidence", "menacing synthetic voice",
  "warm campfire narrator", "broadcast anchor clarity", "cold-hearted villain",
];
const DRAWL_HINTS = ["light desert drawl", "subtle western lilt", "plainspoken ranch cadence", "metallic precision", "no drawl"];
const GRIT_HINTS = ["low grit", "medium grit", "weathered grit", "heavy grit", "synthetic distortion"];
const WARMTH_HINTS = ["steady warmth", "guarded warmth", "friendly edge", "cold and clinical"];
const HUMOR_HINTS = ["dry and playful", "wry and skeptical", "quiet smart-mouth", "deadpan", "no humor"];
const PACING_HINTS = ["slow and deliberate", "measured campfire cadence", "steady with pauses", "brisk and clipped", "rushing and frantic"];
const ACCENT_HINTS = ["neutral US", "Mid-Atlantic", "British RP", "Southern US", "Eastern European", "synthesized / no accent"];
const MOOD_HINTS = ["neutral", "menacing", "thoughtful", "energetic", "amused", "tired", "commanding"];

export function VoiceWorkshopPane() {
  const [subTab, setSubTab] = useState<SubTab>("single");
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [profile, setProfile] = useState<VoiceWorkshopProfile | null>(null);
  const [profileExists, setProfileExists] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>("idle");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function refreshVoices() {
    try {
      const r = await api.voices();
      const merged = mergeRemoteAndLocal(r.local, r.remote?.body?.voices || []);
      setVoices(merged);
      if (!selectedSlug && merged.length) setSelectedSlug(merged[0].slug);
    } catch { /* keep last good */ }
  }

  useEffect(() => { refreshVoices(); }, []);

  useEffect(() => {
    if (!selectedSlug) return;
    let cancelled = false;
    setLoadingProfile(true);
    setSaveState("idle"); setSaveError(null);
    api.loadProfile(selectedSlug).then((r) => {
      if (cancelled) return;
      const fromLibrary = voices.find((v) => v.slug === selectedSlug);
      const next: VoiceWorkshopProfile = {
        ...r.profile,
        displayName: r.profile.displayName || fromLibrary?.displayName || selectedSlug,
      };
      setProfile(next);
      setProfileExists(r.exists);
    }).catch((err) => {
      if (cancelled) return;
      setSaveError(err.message);
    }).finally(() => { if (!cancelled) setLoadingProfile(false); });
    return () => { cancelled = true; };
  }, [selectedSlug]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a || !profile) return;
    a.playbackRate = profile.playback.rate || 1;
    a.volume = Math.max(0, Math.min(1, profile.playback.volume ?? 1));
  }, [profile?.playback.rate, profile?.playback.volume, audioUrl]);

  const selectedVoice = useMemo(() => voices.find((v) => v.slug === selectedSlug), [voices, selectedSlug]);

  function update<K extends keyof VoiceWorkshopProfile>(key: K, value: VoiceWorkshopProfile[K]) {
    setProfile((p) => p ? { ...p, [key]: value } : p);
    setSaveState("idle"); setSaveError(null);
  }
  function updateNested<S extends "character" | "tts" | "playback">(section: S, key: string, value: any) {
    setProfile((p) => p ? { ...p, [section]: { ...(p[section] as any), [key]: value } } as VoiceWorkshopProfile : p);
    setSaveState("idle"); setSaveError(null);
  }

  async function handleSave() {
    if (!profile || !selectedSlug) return;
    setSaveState("saving"); setSaveError(null);
    try {
      const r = await api.saveProfile(selectedSlug, profile);
      setProfile(r.profile);
      setProfileExists(true);
      setSaveState("saved");
      setTimeout(() => setSaveState((s) => s === "saved" ? "idle" : s), 2200);
    } catch (err: any) {
      setSaveError(err.message);
      setSaveState("error");
    }
  }

  async function handlePreview() {
    if (!profile) return;
    setPreviewState("loading"); setPreviewError(null); setAudioUrl(null);
    try {
      const result = await api.speak(selectedSlug, profile.sampleText || "Preview line for the current voice.", {
        exaggeration: profile.tts.exaggeration,
        cfg_weight: profile.tts.cfg_weight,
      });
      if (!result.audio_base64) throw new Error("No audio returned.");
      setAudioUrl(audioFromBase64(result.audio_base64));
      setPreviewState("ready");
    } catch (err: any) {
      setPreviewError(err.message);
      setPreviewState("error");
    }
  }

  return (
    <div className="pane voice-workshop">
      <div className="pane-header">
        <h2>Voice Workshop</h2>
        <p>Pick a voice, identify what kind of character it is, and tune the synthesis dials. Saves to <code>data/voice_profiles/</code> inside this app — never overwrites the source library.</p>
      </div>

      <div className="subtab-strip" role="tablist">
        <button type="button" role="tab" aria-selected={subTab === "single"} className={`subtab${subTab === "single" ? " is-active" : ""}`} onClick={() => setSubTab("single")}>
          <span className="subtab-glyph">◈</span>
          <span><strong>Single Voice</strong><em>Identity, character &amp; sliders</em></span>
        </button>
        <button type="button" role="tab" aria-selected={subTab === "moods"} className={`subtab${subTab === "moods" ? " is-active" : ""}`} onClick={() => setSubTab("moods")}>
          <span className="subtab-glyph">✦</span>
          <span><strong>Mood Library</strong><em>20 prebuilt moods · save / revert</em></span>
        </button>
      </div>

      {subTab === "moods" ? (
        <MoodLibrarySubpane />
      ) : (
      <div className="workshop-grid">
        <aside className="card workshop-list">
          <h3>Choose voice</h3>
          {voices.length === 0 && <p className="muted">No voices found.</p>}
          <div className="voice-list">
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
                </div>
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-ghost" onClick={refreshVoices}>Reload list</button>
        </aside>

        <div className="workshop-form">
          {!profile && loadingProfile && <div className="card"><p className="muted">Loading profile…</p></div>}
          {!profile && !loadingProfile && <div className="card"><p className="muted">Select a voice to edit.</p></div>}
          {profile && (
            <>
              <section className="card">
                <h3>Identity</h3>
                <div className="form-grid">
                  <Field label="Display name">
                    <input type="text" value={profile.displayName} onChange={(e) => update("displayName", e.target.value)} />
                  </Field>
                  <Field label="Voice type">
                    <select value={profile.voiceType} onChange={(e) => update("voiceType", e.target.value)}>
                      {VOICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="Archetype">
                    <input type="text" list="ws-archetypes" value={profile.archetype} onChange={(e) => update("archetype", e.target.value)} placeholder="machine intelligence" />
                    <datalist id="ws-archetypes">{ARCHETYPES.map((a) => <option key={a} value={a} />)}</datalist>
                  </Field>
                  <Field label="Language">
                    <input type="text" value={profile.language} onChange={(e) => update("language", e.target.value)} placeholder="en-US" />
                  </Field>
                </div>
                <Field label="Description / what is this voice?">
                  <textarea rows={2} value={profile.description} onChange={(e) => update("description", e.target.value)} placeholder="One-line shape of who this voice plays."/>
                </Field>
                {selectedVoice && (
                  <p className="muted small">Library reference: <code className="path">{selectedVoice.referenceAudio || "(engine-only)"}</code></p>
                )}
              </section>

              <section className="card">
                <h3>Character dials</h3>
                <div className="form-grid">
                  <Field label="Tone">
                    <input type="text" list="ws-tone" value={profile.character.tone} onChange={(e) => updateNested("character", "tone", e.target.value)} />
                    <datalist id="ws-tone">{TONE_HINTS.map((h) => <option key={h} value={h} />)}</datalist>
                  </Field>
                  <Field label="Drawl / cadence">
                    <input type="text" list="ws-drawl" value={profile.character.drawl} onChange={(e) => updateNested("character", "drawl", e.target.value)} />
                    <datalist id="ws-drawl">{DRAWL_HINTS.map((h) => <option key={h} value={h} />)}</datalist>
                  </Field>
                  <Field label="Grit">
                    <input type="text" list="ws-grit" value={profile.character.grit} onChange={(e) => updateNested("character", "grit", e.target.value)} />
                    <datalist id="ws-grit">{GRIT_HINTS.map((h) => <option key={h} value={h} />)}</datalist>
                  </Field>
                  <Field label="Warmth">
                    <input type="text" list="ws-warmth" value={profile.character.warmth} onChange={(e) => updateNested("character", "warmth", e.target.value)} />
                    <datalist id="ws-warmth">{WARMTH_HINTS.map((h) => <option key={h} value={h} />)}</datalist>
                  </Field>
                  <Field label="Humor">
                    <input type="text" list="ws-humor" value={profile.character.humor} onChange={(e) => updateNested("character", "humor", e.target.value)} />
                    <datalist id="ws-humor">{HUMOR_HINTS.map((h) => <option key={h} value={h} />)}</datalist>
                  </Field>
                  <Field label="Pacing">
                    <input type="text" list="ws-pacing" value={profile.character.pacing} onChange={(e) => updateNested("character", "pacing", e.target.value)} />
                    <datalist id="ws-pacing">{PACING_HINTS.map((h) => <option key={h} value={h} />)}</datalist>
                  </Field>
                  <Field label="Accent">
                    <input type="text" list="ws-accent" value={profile.character.accent} onChange={(e) => updateNested("character", "accent", e.target.value)} />
                    <datalist id="ws-accent">{ACCENT_HINTS.map((h) => <option key={h} value={h} />)}</datalist>
                  </Field>
                  <Field label="Mood (default delivery)">
                    <input type="text" list="ws-mood" value={profile.character.mood} onChange={(e) => updateNested("character", "mood", e.target.value)} />
                    <datalist id="ws-mood">{MOOD_HINTS.map((h) => <option key={h} value={h} />)}</datalist>
                  </Field>
                </div>
              </section>

              <section className="card">
                <h3>Synthesis (Chatterbox TTS)</h3>
                <div className="form-grid form-grid-sliders">
                  <SliderField label="Exaggeration" hint="0.25 = flat, 0.5 = natural, 0.75+ = expressive"
                    value={profile.tts.exaggeration} min={0.1} max={1.5} step={0.05}
                    onChange={(v) => updateNested("tts", "exaggeration", v)} />
                  <SliderField label="cfg_weight" hint="lower = closer to reference voice; higher = more neutral"
                    value={profile.tts.cfg_weight} min={0.1} max={1.0} step={0.05}
                    onChange={(v) => updateNested("tts", "cfg_weight", v)} />
                </div>
                <h3 style={{ marginTop: 18 }}>Playback (browser-side)</h3>
                <div className="form-grid form-grid-sliders">
                  <SliderField label="Rate" value={profile.playback.rate} min={0.5} max={2} step={0.05}
                    onChange={(v) => updateNested("playback", "rate", v)} />
                  <SliderField label="Pitch" hint="visual hint only — Chatterbox is fixed-pitch"
                    value={profile.playback.pitch} min={0} max={2} step={0.05}
                    onChange={(v) => updateNested("playback", "pitch", v)} />
                  <SliderField label="Volume" value={profile.playback.volume} min={0} max={1} step={0.05}
                    onChange={(v) => updateNested("playback", "volume", v)} />
                </div>
              </section>

              <section className="card">
                <h3>Notes & sample line</h3>
                <Field label="Sample text (used by Preview)">
                  <textarea rows={3} value={profile.sampleText} onChange={(e) => update("sampleText", e.target.value)} />
                </Field>
                <Field label="Internal notes">
                  <textarea rows={3} value={profile.notes} onChange={(e) => update("notes", e.target.value)} />
                </Field>
              </section>

              <section className="card workshop-actions">
                <div className="action-row">
                  <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saveState === "saving"}>
                    {saveState === "saving" ? "Saving…" : profileExists ? "Save changes" : "Create profile"}
                  </button>
                  <button type="button" className="btn" onClick={handlePreview} disabled={previewState === "loading"}>
                    {previewState === "loading" ? "Synthesizing…" : "Preview voice"}
                  </button>
                  {saveState === "saved" && <span className="tag tag-good">Saved</span>}
                  {profile.updatedAt && <span className="muted small">Last saved {new Date(profile.updatedAt).toLocaleString()}</span>}
                </div>
                {saveError && <p className="error">{saveError}</p>}
                {previewError && <p className="error">{previewError}</p>}
                {audioUrl && <audio ref={audioRef} controls src={audioUrl} className="audio-player" />}
              </section>
            </>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function SliderField({ label, hint, value, min, max, step, onChange }: { label: string; hint?: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="slider-field">
      <span className="slider-label">
        <strong>{label}</strong>
        <em>{value.toFixed(2)}</em>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <span className="slider-hint">{hint}</span>}
    </label>
  );
}

function mergeRemoteAndLocal(local: VoiceProfile[], remote: any[]): VoiceProfile[] {
  const seen = new Set(local.map((l) => l.slug.toLowerCase()));
  const merged = [...local];
  for (const r of remote) {
    const slug = String(r?.slug || r?.name || "").toLowerCase();
    if (!slug || seen.has(slug)) continue;
    merged.push({
      slug,
      name: r?.name || slug,
      displayName: r?.name || slug,
      description: r?.description || "",
      type: "engine-only",
      referenceAudio: "",
      profilePath: "(only in EnginSam TTS server)",
      libraryRoot: "EnginSam",
      policy: null,
      createdAt: null,
    });
  }
  return merged;
}
