const API_BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!res.ok) {
    throw new Error(body?.error || body?.detail || `Request failed (${res.status})`);
  }
  return body as T;
}

export interface VoiceProfile {
  slug: string;
  name: string;
  displayName: string;
  description: string;
  type: string;
  referenceAudio: string;
  profilePath: string;
  libraryRoot: string;
  policy: { copyright_safe?: boolean; notes?: string[] } | null;
  createdAt: string | null;
}

export interface VoiceWorkshopProfile {
  slug: string;
  schemaVersion: number;
  displayName: string;
  voiceType: string;
  archetype: string;
  description: string;
  character: {
    tone: string;
    drawl: string;
    grit: string;
    warmth: string;
    humor: string;
    pacing: string;
    accent: string;
    mood: string;
  };
  tts: { exaggeration: number; cfg_weight: number };
  playback: { rate: number; pitch: number; volume: number };
  language: string;
  sampleText: string;
  notes: string;
  updatedAt: string | null;
}

export interface SpeakOpts {
  exaggeration?: number;
  cfg_weight?: number;
}

export const api = {
  health: () => request<{ ok: boolean; sidecar: string; port: number }>("/health"),
  ttsStatus: () => request<{ ok: boolean; status: number; body: any }>("/tts/status"),
  voices: () => request<{ ok: boolean; remote: { ok: boolean; status: number; body: any }; local: VoiceProfile[] }>("/tts/voices"),
  speak: (voiceName: string, text: string, opts: SpeakOpts = {}) =>
    request<{ ok: boolean; audio_base64?: string; sample_rate?: number; duration_s?: number }>("/tts/speak", {
      method: "POST",
      body: JSON.stringify({ voiceName, text, ...opts }),
    }),
  ffmpegStatus: () => request<{ ok: boolean; ffmpegPath: string }>("/ffmpeg/status"),
  extractClip: (input: { mediaPath: string; startSec?: number; durationSec?: number; outName?: string }) =>
    request<{ ok: boolean; ffmpegPath: string; clipPath: string }>("/clip/extract", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  library: () => request<{ ok: boolean; voices: VoiceProfile[]; roots: string[] }>("/library"),
  loadProfile: (slug: string) =>
    request<{ ok: boolean; profile: VoiceWorkshopProfile; exists: boolean }>(`/voice-profile/${encodeURIComponent(slug)}`),
  saveProfile: (slug: string, profile: VoiceWorkshopProfile) =>
    request<{ ok: boolean; profile: VoiceWorkshopProfile; savedTo: string }>(`/voice-profile/${encodeURIComponent(slug)}`, {
      method: "POST",
      body: JSON.stringify(profile),
    }),
  listProfiles: () => request<{ ok: boolean; profiles: VoiceWorkshopProfile[] }>("/voice-profiles"),

  voiceMoods: () =>
    request<{ ok: boolean; presetVoices: { slug: string; displayName: string }[]; moods: MoodPreset[] }>("/voice-moods"),
  loadMood: (slug: string, moodId: string) =>
    request<{ ok: boolean; mood: MoodValue; baseline: MoodPreset }>(`/voice-mood/${encodeURIComponent(slug)}/${encodeURIComponent(moodId)}`),
  saveMood: (slug: string, moodId: string, body: { sampleText: string; exaggeration: number; cfg_weight: number; fx: MoodFx; notes?: string }) =>
    request<{ ok: boolean; savedTo: string; mood: MoodValue }>(`/voice-mood/${encodeURIComponent(slug)}/${encodeURIComponent(moodId)}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  revertMood: (slug: string, moodId: string) =>
    request<{ ok: boolean; revertedTo: { slug: string; moodId: string; baseline: MoodPreset } }>(`/voice-mood/${encodeURIComponent(slug)}/${encodeURIComponent(moodId)}`, {
      method: "DELETE",
    }),

  assetRoots: () => request<{ ok: boolean; roots: { id: string; label: string; path: string; exists: boolean }[] }>("/assets/roots"),
  listAssets: (rootId: string) =>
    request<{ ok: boolean; rootId: string; rootPath: string; items: AssetItem[]; warning?: string }>(`/assets/list?rootId=${encodeURIComponent(rootId)}`),
  assetFileUrl: (filePath: string) => `/api/assets/file?path=${encodeURIComponent(filePath)}`,

  claudeStatus: () => request<{ ok: boolean; binary: string; path: string; error?: string }>("/claude/status"),
  claudeChat: (prompt: string) =>
    request<{ ok: boolean; response: string; stderr: string }>("/claude/chat", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),

  listEpisodes: () => request<{ ok: boolean; episodes: { id: string; title: string; updatedAt: string; createdAt: string }[] }>("/episodes"),
  loadEpisode: (id: string) => request<{ ok: boolean; episode: Episode | null; exists: boolean; id?: string }>(`/episode/${encodeURIComponent(id)}`),
  saveEpisode: (id: string, episode: Episode) =>
    request<{ ok: boolean; episode: Episode; savedTo: string }>(`/episode/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify(episode),
    }),
  deleteEpisode: (id: string) =>
    request<{ ok: boolean }>(`/episode/${encodeURIComponent(id)}`, { method: "DELETE" }),
  generateHandoff: (id: string) =>
    request<{ ok: boolean; handoffMdPath: string; handoffJsonPath: string; markdown: string }>(`/episode/${encodeURIComponent(id)}/handoff`, {
      method: "POST",
    }),

  listCandidates: () =>
    request<{ ok: boolean; candidates: ThreeDCandidate[]; discoveredGlbs: GlbAsset[] }>("/3d/candidates"),
  stageCandidate: (imagePath: string, label?: string) =>
    request<{ ok: boolean; candidate: ThreeDCandidate }>("/3d/candidates", {
      method: "POST",
      body: JSON.stringify({ imagePath, label }),
    }),
  updateCandidate: (id: string, patch: Partial<ThreeDCandidate>) =>
    request<{ ok: boolean; candidate: ThreeDCandidate }>(`/3d/candidates/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  deleteCandidate: (id: string) =>
    request<{ ok: boolean }>(`/3d/candidates/${encodeURIComponent(id)}`, { method: "DELETE" }),
  openExternal: (target: string) =>
    request<{ ok: boolean; opened: string }>("/system/open", { method: "POST", body: JSON.stringify({ target }) }),
};

export interface ThreeDCandidate {
  id: string;
  imagePath: string;
  label: string;
  status: "staged" | "sent" | "complete" | string;
  glbPath: string;
  provider: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface GlbAsset {
  name: string;
  path: string;
  ext: string;
  kind: "model";
  size: number;
  rootLabel: string;
}

export interface AssetItem {
  name: string;
  path: string;
  ext: string;
  kind: "folder" | "image" | "video" | "model" | "pdf" | "audio" | "file" | "other";
  size: number;
}

export interface CastMember {
  id: string;
  displayName: string;
  voiceSlug: string;
  role: string;
  moodId: string;
  imagePath: string;
  modelPath: string;
  notes: string;
}

export interface Setting {
  id: string;
  label: string;
  imagePath: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  at: string;
}

export interface Episode {
  id: string;
  title: string;
  directorNotes: string;
  cast: CastMember[];
  settings: Setting[];
  script: string;
  claudeChat: ChatTurn[];
  createdAt: string;
  updatedAt: string;
}

export interface MoodPreset {
  id: string;
  label: string;
  emoji: string;
  description: string;
  sampleText: string;
  exaggeration: number;
  cfg_weight: number;
}

export interface MoodFx {
  rate: number;
  volume: number;
  bass: number;
  presence: number;
  treble: number;
  drive: number;
  reverbMix: number;
  delayMix: number;
  delayTime: number;
  stereo: number;
  compression: number;
}

export const FX_DEFAULTS: MoodFx = {
  rate: 1.0, volume: 1.0,
  bass: 0, presence: 0, treble: 0,
  drive: 0, reverbMix: 0, delayMix: 0, delayTime: 250,
  stereo: 0, compression: 0,
};

export interface MoodValue {
  slug: string;
  moodId: string;
  label: string;
  emoji: string;
  description: string;
  sampleText: string;
  exaggeration: number;
  cfg_weight: number;
  fx: MoodFx;
  notes: string;
  isOverridden: boolean;
  updatedAt: string | null;
}

export function audioFromBase64(b64: string, mime = "audio/wav"): string {
  return `data:${mime};base64,${b64}`;
}
