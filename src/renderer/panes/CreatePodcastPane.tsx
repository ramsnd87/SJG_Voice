import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, type AssetItem, type CastMember, type ChatTurn, type Episode, type MoodPreset, type Setting, type VoiceProfile } from "../lib/api";

const COMMON_SFX = [
  "knock", "door slam", "footsteps", "applause", "crowd murmur", "laugh track",
  "music sting", "whoosh", "glass break", "phone ring", "notification ding",
  "rain", "wind", "engine rev", "gunshot", "explosion", "sword clash",
  "magic shimmer", "heartbeat", "static crackle", "transition swell", "silence",
];

const NEW_ID_PREFIX = "ep";
const STORAGE_LAST_ID = "gsb.lastEpisodeId.v1";

function freshId() {
  return `${NEW_ID_PREFIX}_${Date.now().toString(36)}`;
}

function emptyEpisode(id: string): Episode {
  const now = new Date().toISOString();
  return {
    id, title: "Untitled episode",
    directorNotes: "",
    cast: [], settings: [], script: "",
    claudeChat: [],
    createdAt: now, updatedAt: now,
  };
}

export function CreatePodcastPane() {
  const [episode, setEpisode] = useState<Episode>(() => emptyEpisode(localStorage.getItem(STORAGE_LAST_ID) || freshId()));
  const [allEpisodes, setAllEpisodes] = useState<{ id: string; title: string; updatedAt: string }[]>([]);
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [moods, setMoods] = useState<MoodPreset[]>([]);
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [assetRoot, setAssetRoot] = useState<{ id: string; label: string; path: string; exists: boolean } | null>(null);
  const [claudeAvailable, setClaudeAvailable] = useState<boolean>(false);
  const [claudeBinary, setClaudeBinary] = useState<string>("");
  const [claudeError, setClaudeError] = useState<string | null>(null);
  const [chatPrompt, setChatPrompt] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<{ markdown: string; mdPath: string; jsonPath: string } | null>(null);
  const [pickerTarget, setPickerTarget] = useState<{ kind: "cast" | "setting" | "castModel"; index: number } | null>(null);
  const [savedFlash, setSavedFlash] = useState<Record<string, number>>({});
  const [composerSpeaker, setComposerSpeaker] = useState<string>("");
  const [composerTone, setComposerTone] = useState<string>("");
  const [composerSfx, setComposerSfx] = useState<string>("");
  const [sfxAssetPickerOpen, setSfxAssetPickerOpen] = useState(false);
  const [audioAssets, setAudioAssets] = useState<AssetItem[]>([]);
  const scriptRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => { reloadEpisodeIndex(); reloadVoices(); reloadMoods(); reloadAssetRoots(); reloadClaudeStatus(); }, []);
  useEffect(() => { localStorage.setItem(STORAGE_LAST_ID, episode.id); }, [episode.id]);
  useEffect(() => { if (assetRoot) reloadAssets(assetRoot.id); }, [assetRoot?.id]);
  useEffect(() => {
    if (episode.cast.length && !composerSpeaker) setComposerSpeaker(episode.cast[0].id);
    if (episode.cast.length) {
      const speaker = episode.cast.find((c) => c.id === composerSpeaker);
      if (speaker && !composerTone) setComposerTone(speaker.moodId || (moods[0]?.id ?? ""));
    }
  }, [episode.cast, moods, composerSpeaker]);

  async function reloadEpisodeIndex() {
    try { const r = await api.listEpisodes(); setAllEpisodes(r.episodes); } catch { /* ignore */ }
  }
  async function reloadVoices() {
    try { const r = await api.voices(); setVoices(r.local); } catch { /* ignore */ }
  }
  async function reloadMoods() {
    try { const r = await api.voiceMoods(); setMoods(r.moods); } catch { /* ignore */ }
  }
  async function reloadAssetRoots() {
    try {
      const r = await api.assetRoots();
      const first = r.roots[0] || null;
      setAssetRoot(first);
    } catch { /* ignore */ }
  }
  async function reloadAssets(rootId: string) {
    try { const r = await api.listAssets(rootId); setAssets(r.items); } catch { setAssets([]); }
  }
  async function reloadClaudeStatus() {
    try {
      const r = await api.claudeStatus();
      setClaudeAvailable(r.ok);
      setClaudeBinary(r.binary);
      if (!r.ok) setClaudeError(r.error || "claude CLI not found on PATH");
      else setClaudeError(null);
    } catch (err: any) {
      setClaudeAvailable(false);
      setClaudeError(err.message);
    }
  }

  async function loadEpisode(id: string) {
    try {
      const r = await api.loadEpisode(id);
      if (r.exists && r.episode) setEpisode(r.episode);
      else setEpisode(emptyEpisode(id));
      setHandoff(null);
    } catch (err: any) { setSaveError(err.message); }
  }

  function newEpisode() {
    setEpisode(emptyEpisode(freshId()));
    setHandoff(null);
    setSaveState("idle");
  }

  async function handleSave(flashKey?: string) {
    setSaveState("saving"); setSaveError(null);
    try {
      const r = await api.saveEpisode(episode.id, episode);
      setEpisode(r.episode);
      setSaveState("saved");
      reloadEpisodeIndex();
      if (flashKey) {
        const stamp = Date.now();
        setSavedFlash((m) => ({ ...m, [flashKey]: stamp }));
        setTimeout(() => setSavedFlash((m) => (m[flashKey] === stamp ? { ...m, [flashKey]: 0 } : m)), 2200);
      }
      setTimeout(() => setSaveState((s) => s === "saved" ? "idle" : s), 2000);
    } catch (err: any) {
      setSaveError(err.message);
      setSaveState("error");
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete episode "${episode.title}"? This removes data/episodes/${episode.id}/.`)) return;
    try { await api.deleteEpisode(episode.id); newEpisode(); reloadEpisodeIndex(); } catch (err: any) { setSaveError(err.message); }
  }

  async function handleHandoff() {
    setSaveError(null);
    try {
      // Save first to make sure handoff reads latest
      await api.saveEpisode(episode.id, episode);
      const r = await api.generateHandoff(episode.id);
      setHandoff({ markdown: r.markdown, mdPath: r.handoffMdPath, jsonPath: r.handoffJsonPath });
    } catch (err: any) { setSaveError(err.message); }
  }

  function addCast() {
    const id = `cast_${Date.now().toString(36)}`;
    setEpisode((e) => ({
      ...e,
      cast: [...e.cast, { id, displayName: "New cast member", voiceSlug: voices[0]?.slug || "", role: "host", moodId: moods[0]?.id || "calm", imagePath: "", modelPath: "", notes: "" }],
    }));
  }
  function updateCast(idx: number, patch: Partial<CastMember>) {
    setEpisode((e) => ({ ...e, cast: e.cast.map((c, i) => i === idx ? { ...c, ...patch } : c) }));
  }
  function removeCast(idx: number) {
    setEpisode((e) => ({ ...e, cast: e.cast.filter((_, i) => i !== idx) }));
  }

  function addSetting() {
    const id = `set_${Date.now().toString(36)}`;
    setEpisode((e) => ({ ...e, settings: [...e.settings, { id, label: "New setting", imagePath: "" }] }));
  }
  function updateSetting(idx: number, patch: Partial<Setting>) {
    setEpisode((e) => ({ ...e, settings: e.settings.map((s, i) => i === idx ? { ...s, ...patch } : s) }));
  }
  function removeSetting(idx: number) {
    setEpisode((e) => ({ ...e, settings: e.settings.filter((_, i) => i !== idx) }));
  }

  function pickAsset(item: AssetItem) {
    if (!pickerTarget) return;
    if (pickerTarget.kind === "cast") updateCast(pickerTarget.index, { imagePath: item.path });
    else if (pickerTarget.kind === "castModel") updateCast(pickerTarget.index, { modelPath: item.path });
    else updateSetting(pickerTarget.index, { imagePath: item.path });
    setPickerTarget(null);
  }

  function insertAtCursor(snippet: string) {
    const ta = scriptRef.current;
    if (!ta) {
      setEpisode((e) => ({ ...e, script: (e.script || "") + snippet }));
      return;
    }
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    const next = before + snippet + after;
    setEpisode((e) => ({ ...e, script: next }));
    requestAnimationFrame(() => {
      const t = scriptRef.current;
      if (!t) return;
      t.focus();
      const caret = (before + snippet).length;
      t.setSelectionRange(caret, caret);
    });
  }

  function insertDialogueLine() {
    const speaker = episode.cast.find((c) => c.id === composerSpeaker);
    if (!speaker) return;
    const tone = composerTone || speaker.moodId;
    const moodLabel = moods.find((m) => m.id === tone)?.label || tone;
    const ta = scriptRef.current;
    const needsLeadingNewline = ta && ta.selectionStart > 0 && ta.value[ta.selectionStart - 1] !== "\n";
    const prefix = needsLeadingNewline ? "\n" : "";
    insertAtCursor(`${prefix}[${speaker.displayName} | ${moodLabel}] `);
  }

  function insertSfx(label: string) {
    const trimmed = label.trim();
    if (!trimmed) return;
    const ta = scriptRef.current;
    const needsLeadingNewline = ta && ta.selectionStart > 0 && ta.value[ta.selectionStart - 1] !== "\n";
    const prefix = needsLeadingNewline ? "\n" : "";
    insertAtCursor(`${prefix}[SFX: ${trimmed}]\n`);
  }

  async function openSfxAssetPicker() {
    if (!assetRoot) return;
    try {
      const r = await api.listAssets(assetRoot.id);
      setAudioAssets(r.items.filter((a) => a.kind === "audio"));
      setSfxAssetPickerOpen(true);
    } catch { /* ignore */ }
  }

  function buildClaudeContext(userPrompt: string) {
    const cast = episode.cast.map((c) => `- ${c.displayName} (voice: ${c.voiceSlug}, mood: ${c.moodId}, role: ${c.role})`).join("\n") || "(none)";
    const settings = episode.settings.map((s) => `- ${s.label} → ${s.imagePath || "(no image)"}`).join("\n") || "(none)";
    return [
      "You are helping the user build a podcast episode in Glitch Studio Builder.",
      "Tools you can use locally (the user's machine):",
      "- EnginSam Chatterbox TTS at http://127.0.0.1:8018 (proxied via Glitch sidecar /api/tts/speak).",
      "- Voice library + mood presets in Glitch Studio Builder.",
      "- ffmpeg for audio extraction.",
      "",
      "Episode context:",
      `Title: ${episode.title}`,
      `Director notes: ${episode.directorNotes || "(none)"}`,
      "",
      "Cast:",
      cast,
      "",
      "Settings:",
      settings,
      "",
      "Current script:",
      "```",
      episode.script || "(empty)",
      "```",
      "",
      "User prompt:",
      userPrompt,
    ].join("\n");
  }

  async function sendToClaude() {
    if (!chatPrompt.trim() || chatBusy) return;
    const userTurn: ChatTurn = { role: "user", text: chatPrompt, at: new Date().toISOString() };
    setEpisode((e) => ({ ...e, claudeChat: [...e.claudeChat, userTurn] }));
    const fullPrompt = buildClaudeContext(chatPrompt);
    setChatPrompt("");
    setChatBusy(true);
    setClaudeError(null);
    try {
      const r = await api.claudeChat(fullPrompt);
      const turn: ChatTurn = { role: "assistant", text: r.response, at: new Date().toISOString() };
      setEpisode((e) => ({ ...e, claudeChat: [...e.claudeChat, turn] }));
    } catch (err: any) {
      setClaudeError(err.message);
    } finally {
      setChatBusy(false);
    }
  }

  function copyHandoff() {
    if (handoff) navigator.clipboard?.writeText(handoff.markdown);
  }

  const voiceMap = useMemo(() => new Map(voices.map((v) => [v.slug, v])), [voices]);

  return (
    <div className="pane create-podcast">
      <div className="pane-header">
        <h2>Create Podcast</h2>
        <p>Plan an episode end-to-end: cast and voices, scene images, the script, a Claude chat scoped to your local studio, and a final handoff bundle.</p>
      </div>

      <section className="card cp-toolbar">
        <div className="row cp-toolbar-row">
          <label className="field" style={{ flex: 1, minWidth: 240 }}>
            <span>Episode title</span>
            <input type="text" value={episode.title} onChange={(e) => setEpisode((ep) => ({ ...ep, title: e.target.value }))} />
          </label>
          <label className="field" style={{ width: 220 }}>
            <span>Open existing</span>
            <select value="" onChange={(e) => { if (e.target.value) loadEpisode(e.target.value); }}>
              <option value="">— pick —</option>
              {allEpisodes.map((ep) => <option key={ep.id} value={ep.id}>{ep.title} · {new Date(ep.updatedAt).toLocaleDateString()}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-ghost" onClick={newEpisode}>New episode</button>
          <button type="button" className="btn btn-primary" onClick={() => handleSave()} disabled={saveState === "saving"}>
            {saveState === "saving" ? "Saving…" : "Save"}
          </button>
          <button type="button" className="btn" onClick={handleDelete}>Delete</button>
          {saveState === "saved" && <span className="tag tag-good">Saved</span>}
          <span className="muted small">id: <code>{episode.id}</code></span>
        </div>
        {saveError && <p className="error">{saveError}</p>}
      </section>

      <section className="card">
        <h3>Director notes</h3>
        <textarea rows={3} value={episode.directorNotes} onChange={(e) => setEpisode((ep) => ({ ...ep, directorNotes: e.target.value }))} placeholder="High-level intent for this episode — pacing, scene count, takeaways."/>
      </section>

      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Cast</h3>
          <div className="row" style={{ gap: 8 }}>
            {episode.updatedAt && <span className="muted small">last saved {new Date(episode.updatedAt).toLocaleTimeString()}</span>}
            <button type="button" className="btn btn-primary btn-mini" onClick={() => handleSave("cast-section")} disabled={saveState === "saving"}>
              {saveState === "saving" ? "Saving…" : "Save cast"}
            </button>
            {savedFlash["cast-section"] && <span className="tag tag-good">Saved ✓</span>}
            <button type="button" className="btn btn-ghost" onClick={addCast}>+ Add cast member</button>
          </div>
        </div>
        {episode.cast.length === 0 && <p className="muted">No cast yet. Add Sam, Jack, Glitch, or a custom voice.</p>}
        <div className="cp-cast-grid">
          {episode.cast.map((c, idx) => {
            const v = voiceMap.get(c.voiceSlug);
            return (
              <div key={c.id} className="cp-cast-card">
                <div className="cp-cast-visual">
                  {c.modelPath ? (
                    <model-viewer
                      src={api.assetFileUrl(c.modelPath)}
                      alt={`${c.displayName} 3D model`}
                      camera-controls
                      auto-rotate
                      auto-rotate-delay={1500}
                      shadow-intensity={0.6}
                      exposure={1}
                      className="cp-cast-model"
                    />
                  ) : c.imagePath ? (
                    <img src={api.assetFileUrl(c.imagePath)} alt={c.displayName} className="cp-cast-thumb" />
                  ) : (
                    <div className="cp-image-placeholder">no image / model</div>
                  )}
                  <div className="cp-cast-visual-actions">
                    <button type="button" className="btn btn-mini" onClick={() => setPickerTarget({ kind: "cast", index: idx })}>{c.imagePath ? "Replace image" : "Pick image"}</button>
                    <button type="button" className="btn btn-mini" onClick={() => setPickerTarget({ kind: "castModel", index: idx })}>{c.modelPath ? "Replace 3D" : "Pick 3D model"}</button>
                    {c.modelPath && <button type="button" className="btn btn-mini btn-ghost" onClick={() => updateCast(idx, { modelPath: "" })}>Clear 3D</button>}
                  </div>
                  {c.modelPath && (
                    <code className="path mono small" title={c.modelPath}>{c.modelPath.split(/[\\/]/).slice(-1)[0]}</code>
                  )}
                </div>
                <div className="cp-cast-fields">
                  <label className="field"><span>Display name</span>
                    <input type="text" value={c.displayName} onChange={(e) => updateCast(idx, { displayName: e.target.value })} />
                  </label>
                  <label className="field"><span>Voice</span>
                    <select value={c.voiceSlug} onChange={(e) => updateCast(idx, { voiceSlug: e.target.value })}>
                      <option value="">— none —</option>
                      {voices.map((vv) => <option key={vv.slug} value={vv.slug}>{vv.displayName} ({vv.slug})</option>)}
                    </select>
                  </label>
                  <label className="field"><span>Mood</span>
                    <select value={c.moodId} onChange={(e) => updateCast(idx, { moodId: e.target.value })}>
                      {moods.map((m) => <option key={m.id} value={m.id}>{m.emoji} {m.label}</option>)}
                    </select>
                  </label>
                  <label className="field"><span>Role</span>
                    <input type="text" value={c.role} onChange={(e) => updateCast(idx, { role: e.target.value })} placeholder="host, co-host, antagonist…"/>
                  </label>
                  <label className="field" style={{ gridColumn: "1 / -1" }}><span>Notes</span>
                    <textarea rows={2} value={c.notes} onChange={(e) => updateCast(idx, { notes: e.target.value })} />
                  </label>
                  <div className="row" style={{ gridColumn: "1 / -1", justifyContent: "flex-end", gap: 6 }}>
                    {savedFlash[`cast-${c.id}`] && <span className="tag tag-good">Saved ✓</span>}
                    <button type="button" className="btn btn-primary btn-mini" onClick={() => handleSave(`cast-${c.id}`)} disabled={saveState === "saving"}>Save</button>
                    <button type="button" className="btn btn-ghost btn-mini" onClick={() => removeCast(idx)}>Remove</button>
                  </div>
                </div>
                {!v && c.voiceSlug && <p className="muted small">⚠ voice slug "{c.voiceSlug}" not found in current library</p>}
              </div>
            );
          })}
        </div>
      </section>

      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Settings &amp; scene images</h3>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-primary btn-mini" onClick={() => handleSave("settings-section")} disabled={saveState === "saving"}>
              {saveState === "saving" ? "Saving…" : "Save settings"}
            </button>
            {savedFlash["settings-section"] && <span className="tag tag-good">Saved ✓</span>}
            <button type="button" className="btn btn-ghost" onClick={addSetting}>+ Add setting</button>
          </div>
        </div>
        {episode.settings.length === 0 && <p className="muted">Pull scene/background images from RAM SND Asset.</p>}
        <div className="cp-settings-grid">
          {episode.settings.map((s, idx) => (
            <div key={s.id} className="cp-setting-card">
              <div className="cp-cast-image">
                {s.imagePath
                  ? <img src={api.assetFileUrl(s.imagePath)} alt={s.label} />
                  : <div className="cp-image-placeholder">no image</div>}
                <button type="button" className="btn btn-mini" onClick={() => setPickerTarget({ kind: "setting", index: idx })}>{s.imagePath ? "Replace" : "Pick image"}</button>
              </div>
              <label className="field"><span>Label</span>
                <input type="text" value={s.label} onChange={(e) => updateSetting(idx, { label: e.target.value })} />
              </label>
              <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                {savedFlash[`setting-${s.id}`] && <span className="tag tag-good">Saved ✓</span>}
                <button type="button" className="btn btn-primary btn-mini" onClick={() => handleSave(`setting-${s.id}`)} disabled={saveState === "saving"}>Save</button>
                <button type="button" className="btn btn-ghost btn-mini" onClick={() => removeSetting(idx)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>Script</h3>
        <p className="muted small">Edit freely here. The handoff bundles whatever's in this box. Use the composer below to insert dialogue lines and sound effects at your cursor.</p>

        <div className="cp-composer">
          <div className="cp-composer-row">
            <label className="field" style={{ flex: "1 1 200px" }}>
              <span>Speaker</span>
              <select value={composerSpeaker} onChange={(e) => {
                setComposerSpeaker(e.target.value);
                const sp = episode.cast.find((c) => c.id === e.target.value);
                if (sp?.moodId) setComposerTone(sp.moodId);
              }}>
                <option value="">— pick from cast —</option>
                {episode.cast.map((c) => <option key={c.id} value={c.id}>{c.displayName} ({c.voiceSlug || "no voice"})</option>)}
              </select>
            </label>
            <label className="field" style={{ flex: "1 1 200px" }}>
              <span>Tone (from mood library)</span>
              <select value={composerTone} onChange={(e) => setComposerTone(e.target.value)}>
                <option value="">— pick a mood —</option>
                {moods.map((m) => <option key={m.id} value={m.id}>{m.emoji} {m.label} — {m.description}</option>)}
              </select>
            </label>
            <button type="button" className="btn btn-primary" onClick={insertDialogueLine} disabled={!composerSpeaker}>
              Insert dialogue line
            </button>
          </div>
          {composerTone && moods.find((m) => m.id === composerTone) && (
            <p className="cp-tone-hint muted small">
              <strong>Sample for "{moods.find((m) => m.id === composerTone)?.label}":</strong> "{moods.find((m) => m.id === composerTone)?.sampleText}"
            </p>
          )}

          <div className="cp-composer-row cp-sfx-row">
            <label className="field" style={{ flex: "1 1 220px" }}>
              <span>Sound effect</span>
              <input
                type="text"
                list="sfx-common"
                value={composerSfx}
                onChange={(e) => setComposerSfx(e.target.value)}
                placeholder="e.g. door slam, applause, music sting"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); insertSfx(composerSfx); setComposerSfx(""); } }}
              />
              <datalist id="sfx-common">{COMMON_SFX.map((s) => <option key={s} value={s} />)}</datalist>
            </label>
            <button type="button" className="btn" onClick={() => { insertSfx(composerSfx); setComposerSfx(""); }} disabled={!composerSfx.trim()}>
              Insert SFX
            </button>
            <button type="button" className="btn btn-ghost" onClick={openSfxAssetPicker} disabled={!assetRoot}>
              Pick from audio assets…
            </button>
          </div>
          <div className="cp-sfx-quickrow">
            {COMMON_SFX.slice(0, 12).map((s) => (
              <button key={s} type="button" className="cp-sfx-chip" onClick={() => insertSfx(s)}>+ {s}</button>
            ))}
          </div>
        </div>

        <textarea
          ref={scriptRef}
          rows={16}
          value={episode.script}
          onChange={(e) => setEpisode((ep) => ({ ...ep, script: e.target.value }))}
          placeholder={"[Sam | Calm] Welcome back to the show…\n[SFX: music sting]\n[Jack | Playful] Wait, what are we doing today?"}
          className="cp-script"
        />
      </section>

      <section className="card cp-claude">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Claude assistant</h3>
          <span className={`chip ${claudeAvailable ? "chip-good" : "chip-warn"}`}>
            <span className="chip-dot" /> {claudeAvailable ? `claude ready (${claudeBinary})` : "claude CLI offline"}
          </span>
        </div>
        <p className="muted small">The sidecar pipes your prompt + the current cast/settings/script into <code>{claudeBinary || "claude"} --print</code>. It's a one-shot per send.</p>
        {claudeError && <p className="error">{claudeError}</p>}

        <div className="cp-chat">
          {episode.claudeChat.length === 0 && <p className="muted small">Send a prompt below — Claude sees the cast, settings, and current script automatically.</p>}
          {episode.claudeChat.map((turn, i) => (
            <div key={i} className={`cp-chat-bubble cp-chat-${turn.role}`}>
              <div className="cp-chat-meta">{turn.role === "user" ? "You" : "Claude"} · {new Date(turn.at).toLocaleTimeString()}</div>
              <div className="cp-chat-text">{turn.text}</div>
            </div>
          ))}
          {chatBusy && <div className="cp-chat-bubble cp-chat-assistant"><div className="cp-chat-text muted">Claude is thinking…</div></div>}
        </div>

        <div className="row">
          <textarea rows={3} value={chatPrompt} onChange={(e) => setChatPrompt(e.target.value)} placeholder="Ask Claude to draft an opening, sharpen a scene, write the next exchange…" style={{ flex: 1 }}/>
          <button type="button" className="btn btn-primary" onClick={sendToClaude} disabled={!claudeAvailable || chatBusy || !chatPrompt.trim()}>
            {chatBusy ? "Sending…" : "Send to Claude"}
          </button>
        </div>
      </section>

      <section className="card cp-handoff">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Handoff to Claude</h3>
          <button type="button" className="btn btn-primary" onClick={handleHandoff}>Generate handoff</button>
        </div>
        <p className="muted small">Bundles cast, settings, script, and a tools manifest into a markdown brief Claude can read directly. Saved next to the episode in <code>data/episodes/{episode.id}/</code>.</p>
        {handoff && (
          <>
            <div className="row">
              <span className="tag tag-good">Generated</span>
              <code className="path">{handoff.mdPath}</code>
              <button type="button" className="btn btn-ghost" onClick={copyHandoff}>Copy markdown</button>
            </div>
            <pre className="cp-handoff-preview">{handoff.markdown}</pre>
          </>
        )}
      </section>

      {pickerTarget && (
        <AssetPicker
          assets={assets}
          rootLabel={assetRoot?.label || "(asset root)"}
          rootPath={assetRoot?.path || ""}
          onPick={pickAsset}
          onClose={() => setPickerTarget(null)}
          assetUrl={api.assetFileUrl}
          initialKind={pickerTarget.kind === "castModel" ? "model" : "image"}
        />
      )}

      {sfxAssetPickerOpen && (
        <div className="cp-picker-overlay" onClick={() => setSfxAssetPickerOpen(false)}>
          <div className="cp-picker" onClick={(e) => e.stopPropagation()}>
            <header className="cp-picker-head">
              <div>
                <h3>Pick an SFX from audio assets</h3>
                <p className="muted small">Audio files in {assetRoot?.label}. The filename (without extension) gets inserted as <code>[SFX: name]</code>.</p>
              </div>
              <button type="button" className="btn btn-ghost" onClick={() => setSfxAssetPickerOpen(false)}>Close</button>
            </header>
            <div className="cp-picker-grid">
              {audioAssets.map((a) => (
                <button key={a.path} type="button" className="cp-picker-item" onClick={() => {
                  insertSfx(a.name.replace(/\.[^.]+$/, ""));
                  setSfxAssetPickerOpen(false);
                }}>
                  <div className="cp-picker-icon">♪</div>
                  <span className="cp-picker-name">{a.name}</span>
                </button>
              ))}
              {audioAssets.length === 0 && <p className="muted">No audio files discovered in this asset root.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AssetPicker({ assets, rootLabel, rootPath, onPick, onClose, assetUrl, initialKind = "image" }: {
  assets: AssetItem[];
  rootLabel: string; rootPath: string;
  onPick: (item: AssetItem) => void;
  onClose: () => void;
  assetUrl: (path: string) => string;
  initialKind?: "all" | "image" | "video" | "model";
}) {
  const [filter, setFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "image" | "video" | "model">(initialKind);
  const filtered = assets.filter((a) =>
    (kindFilter === "all" || a.kind === kindFilter) &&
    (filter.trim() === "" || a.name.toLowerCase().includes(filter.trim().toLowerCase()))
  );
  return (
    <div className="cp-picker-overlay" onClick={onClose}>
      <div className="cp-picker" onClick={(e) => e.stopPropagation()}>
        <header className="cp-picker-head">
          <div>
            <h3>Pick an asset</h3>
            <p className="muted small">{rootLabel} — {rootPath}</p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
        </header>
        <div className="row">
          <input type="text" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by filename…" style={{ flex: 1 }}/>
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as any)}>
            <option value="all">All</option>
            <option value="image">Images</option>
            <option value="video">Videos</option>
            <option value="model">3D models</option>
          </select>
        </div>
        <div className="cp-picker-grid">
          {filtered.map((a) => (
            <button key={a.path} type="button" className="cp-picker-item" onClick={() => onPick(a)}>
              {a.kind === "image" && <img src={assetUrl(a.path)} alt={a.name} />}
              {a.kind === "model" && (
                <model-viewer
                  src={assetUrl(a.path)}
                  alt={a.name}
                  camera-controls
                  auto-rotate
                  auto-rotate-delay={800}
                  shadow-intensity={0.4}
                  className="cp-picker-model"
                />
              )}
              {a.kind !== "image" && a.kind !== "model" && (
                <div className="cp-picker-icon">{a.kind === "video" ? "▶" : a.kind === "audio" ? "♪" : "📄"}</div>
              )}
              <span className="cp-picker-name">{a.name}</span>
            </button>
          ))}
          {filtered.length === 0 && <p className="muted">No matches.</p>}
        </div>
      </div>
    </div>
  );
}
