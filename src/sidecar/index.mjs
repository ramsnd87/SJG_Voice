import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const PATHS = JSON.parse(await fs.readFile(path.join(ROOT, "config", "paths.json"), "utf8"));

const CLIPS_DIR = path.resolve(ROOT, PATHS.writeDirs.clipsDir);
const STAGED_DIR = path.resolve(ROOT, PATHS.writeDirs.stagedVoicesDir);
const PROFILES_DIR = path.resolve(ROOT, PATHS.writeDirs.voiceProfilesDir || "data\\voice_profiles");
const MOODS_DIR = path.resolve(ROOT, "data", "voice_moods");
const EPISODES_DIR = path.resolve(ROOT, "data", "episodes");
const CANDIDATES_FILE = path.resolve(ROOT, "data", "3d_candidates.json");
await fs.mkdir(CLIPS_DIR, { recursive: true });
await fs.mkdir(STAGED_DIR, { recursive: true });
await fs.mkdir(PROFILES_DIR, { recursive: true });
await fs.mkdir(MOODS_DIR, { recursive: true });
await fs.mkdir(EPISODES_DIR, { recursive: true });

const MOOD_PRESETS = JSON.parse(await fs.readFile(path.join(ROOT, "config", "voice_moods.json"), "utf8"));
const MOOD_BY_ID = new Map(MOOD_PRESETS.moods.map((m) => [m.id, m]));

const AUDIO_EXT = new Set([".wav", ".mp3", ".flac", ".m4a", ".ogg"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".mkv", ".avi", ".webm"]);

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

async function pathExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function findFfmpeg() {
  const envPath = process.env[PATHS.ffmpegEnv] || process.env.FFMPEG_PATH;
  if (envPath && await pathExists(envPath)) return envPath;
  const cmd = process.platform === "win32" ? "where.exe" : "which";
  try {
    const { stdout } = await execFileAsync(cmd, ["ffmpeg"], { windowsHide: true });
    const first = String(stdout).split(/\r?\n/).map((l) => l.trim()).find(Boolean);
    return first || "";
  } catch { return ""; }
}

async function ttsProxy(pathname, init) {
  const url = `${PATHS.engineSamTtsBaseUrl}${pathname}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* leave null */ }
    return { ok: r.ok, status: r.status, json, text };
  } catch (err) {
    return { ok: false, status: 503, json: null, text: String(err?.message || err) };
  } finally {
    clearTimeout(t);
  }
}

async function listLocalVoices() {
  // Roots are listed engine-first in paths.json; first hit per slug wins so the
  // EnginSam tts-server copy is treated as authoritative when a slug appears in
  // multiple library roots.
  const hide = new Set((PATHS.hideSlugs || []).map((s) => String(s).toLowerCase()));
  const seen = new Map();
  for (const root of PATHS.voiceLibraryRoots) {
    if (!(await pathExists(root))) continue;
    let entries;
    try { entries = await fs.readdir(root, { withFileTypes: true }); }
    catch { continue; }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const voiceDir = path.join(root, ent.name);
      const metaPath = path.join(voiceDir, "meta.json");
      let meta = null;
      try { meta = JSON.parse(await fs.readFile(metaPath, "utf8")); } catch { /* skip */ }
      if (!meta) continue;
      const slug = String(meta.slug || ent.name).toLowerCase();
      if (hide.has(slug)) continue;
      if (seen.has(slug)) {
        seen.get(slug).alsoIn.push(root);
        continue;
      }
      const refCandidates = ["reference.wav", "reference.mp3", "reference.flac", "reference.m4a", "reference.ogg"];
      let referenceAudio = "";
      for (const r of refCandidates) {
        const p = path.join(voiceDir, r);
        if (await pathExists(p)) { referenceAudio = p; break; }
      }
      seen.set(slug, {
        slug,
        name: meta.name || meta.display_name || ent.name,
        displayName: meta.display_name || meta.name || ent.name,
        description: meta.description || "",
        type: meta.type || "voice",
        referenceAudio,
        profilePath: voiceDir,
        libraryRoot: root,
        alsoIn: [],
        policy: meta.policy || null,
        createdAt: meta.created_at || meta.createdAt || null,
      });
    }
  }
  return [...seen.values()];
}

async function extractAudioFromMedia({ mediaPath, startSec, durationSec, outName }) {
  const ffmpeg = await findFfmpeg();
  if (!ffmpeg) throw Object.assign(new Error("ffmpeg not found. Install or set FFMPEG_PATH."), { status: 409 });
  const ext = path.extname(mediaPath).toLowerCase();
  if (!AUDIO_EXT.has(ext) && !VIDEO_EXT.has(ext)) {
    throw Object.assign(new Error("Unsupported media type."), { status: 400 });
  }
  const safeName = (outName || `clip-${Date.now()}`).replace(/[^a-zA-Z0-9_\-]/g, "_");
  const target = path.join(CLIPS_DIR, `${safeName}.wav`);
  const args = ["-y"];
  if (Number.isFinite(startSec) && startSec > 0) args.push("-ss", String(startSec));
  args.push("-i", mediaPath);
  if (Number.isFinite(durationSec) && durationSec > 0) args.push("-t", String(durationSec));
  args.push("-vn", "-acodec", "pcm_s16le", "-ar", "24000", "-ac", "1", target);
  await execFileAsync(ffmpeg, args, { windowsHide: true });
  return { ffmpegPath: ffmpeg, clipPath: target };
}

const ASSET_MIMES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp" };

async function streamAsset(res, absolutePath) {
  if (!(await pathExists(absolutePath))) {
    sendError(res, 404, `Asset not found: ${absolutePath}`);
    return true;
  }
  const ext = path.extname(absolutePath).toLowerCase();
  const mime = ASSET_MIMES[ext] || "application/octet-stream";
  const buf = await fs.readFile(absolutePath);
  res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=300" });
  res.end(buf);
  return true;
}

const ROUTES = {
  "GET /api/health": async () => ({ ok: true, sidecar: "glitch-studio-builder", port: PATHS.sidecarPort }),
  "GET /api/tts/status": async () => {
    const r = await ttsProxy("/status");
    return { ok: r.ok, status: r.status, body: r.json };
  },
  "GET /api/tts/voices": async () => {
    const remote = await ttsProxy("/voices");
    const local = await listLocalVoices();
    return {
      ok: true,
      remote: { ok: remote.ok, status: remote.status, body: remote.json },
      local,
    };
  },
  "POST /api/tts/speak": async (req) => {
    const body = await readJson(req);
    const speakBody = {
      text: body.text,
      voice_name: body.voiceName || body.voice_name || "sam",
    };
    if (Number.isFinite(Number(body.exaggeration))) speakBody.exaggeration = Number(body.exaggeration);
    if (Number.isFinite(Number(body.cfg_weight ?? body.cfgWeight))) speakBody.cfg_weight = Number(body.cfg_weight ?? body.cfgWeight);
    const r = await ttsProxy("/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(speakBody),
    });
    if (!r.ok) {
      throw Object.assign(new Error(r.json?.detail || r.json?.error || `TTS failed (${r.status})`), { status: r.status || 502 });
    }
    return r.json;
  },
  "POST /api/clip/extract": async (req) => {
    const body = await readJson(req);
    if (!body.mediaPath) throw Object.assign(new Error("mediaPath is required"), { status: 400 });
    if (!(await pathExists(body.mediaPath))) throw Object.assign(new Error(`Not found: ${body.mediaPath}`), { status: 404 });
    const result = await extractAudioFromMedia({
      mediaPath: body.mediaPath,
      startSec: Number(body.startSec) || 0,
      durationSec: Number(body.durationSec) || 0,
      outName: body.outName,
    });
    return { ok: true, ...result };
  },
  "GET /api/ffmpeg/status": async () => {
    const ff = await findFfmpeg();
    return { ok: Boolean(ff), ffmpegPath: ff };
  },
  "GET /api/library": async () => {
    return { ok: true, voices: await listLocalVoices(), roots: PATHS.voiceLibraryRoots };
  },
  "GET /api/asset/ram-logo": async (_req, _url, res) => {
    await streamAsset(res, PATHS.ramLogoPath);
    return Symbol.for("handled");
  },
  "GET /api/voice-moods": async () => {
    return { ok: true, presetVoices: MOOD_PRESETS.presetVoices, moods: MOOD_PRESETS.moods };
  },
  "GET /api/assets/roots": async () => {
    const roots = [];
    for (const r of (PATHS.assetRoots || [])) {
      const exists = await pathExists(r.path);
      roots.push({ id: r.id, label: r.label, path: r.path, exists });
    }
    return { ok: true, roots };
  },
  "GET /api/assets/list": async (_req, url) => {
    const rootId = url.searchParams.get("rootId") || (PATHS.assetRoots?.[0]?.id || "");
    const root = (PATHS.assetRoots || []).find((r) => r.id === rootId);
    if (!root) throw Object.assign(new Error("Unknown asset root"), { status: 404 });
    if (!(await pathExists(root.path))) {
      return { ok: true, rootId: root.id, rootPath: root.path, items: [], warning: "asset root does not exist on disk" };
    }
    const items = [];
    const entries = await fs.readdir(root.path, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(root.path, ent.name);
      const ext = path.extname(ent.name).toLowerCase();
      let kind = "other";
      if (ent.isDirectory()) kind = "folder";
      else if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext)) kind = "image";
      else if ([".mp4", ".mov", ".webm", ".m4v", ".mkv"].includes(ext)) kind = "video";
      else if ([".glb", ".gltf"].includes(ext)) kind = "model";
      else if ([".pdf"].includes(ext)) kind = "pdf";
      else if ([".mp3", ".wav", ".ogg", ".flac", ".m4a"].includes(ext)) kind = "audio";
      else if (ent.isFile()) kind = "file";
      let size = 0;
      try { size = (await fs.stat(full)).size; } catch { /* ignore */ }
      items.push({ name: ent.name, path: full, ext, kind, size });
    }
    items.sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, rootId: root.id, rootPath: root.path, items };
  },
  "GET /api/claude/status": async () => {
    try {
      const cmd = process.platform === "win32" ? "where.exe" : "which";
      const { stdout } = await execFileAsync(cmd, [PATHS.claudeBinary || "claude"], { windowsHide: true });
      const found = String(stdout).split(/\r?\n/).map((l) => l.trim()).find(Boolean) || "";
      return { ok: !!found, binary: PATHS.claudeBinary || "claude", path: found };
    } catch (err) {
      return { ok: false, binary: PATHS.claudeBinary || "claude", path: "", error: err.message };
    }
  },
  "GET /api/3d/candidates": async () => {
    const candidates = await readCandidates();
    const discovered = await discoverGlbAssets();
    return { ok: true, candidates, discoveredGlbs: discovered };
  },
  "POST /api/3d/candidates": async (req) => {
    const body = await readJson(req);
    if (!body?.imagePath) throw Object.assign(new Error("imagePath required"), { status: 400 });
    const allowed = (PATHS.assetRoots || []).some((r) => {
      const root = path.resolve(r.path);
      const p = path.resolve(body.imagePath);
      return p === root || p.startsWith(root + path.sep);
    });
    if (!allowed) throw Object.assign(new Error("imagePath not under any asset root"), { status: 403 });
    const candidates = await readCandidates();
    const id = `cand_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const candidate = {
      id,
      imagePath: body.imagePath,
      label: typeof body.label === "string" && body.label.trim() ? body.label.trim() : path.basename(body.imagePath, path.extname(body.imagePath)),
      status: "staged",
      glbPath: "",
      provider: "",
      notes: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    candidates.push(candidate);
    await writeCandidates(candidates);
    return { ok: true, candidate };
  },
  "POST /api/system/open": async (req) => {
    const body = await readJson(req);
    const target = String(body?.target || "").trim();
    if (!target) throw Object.assign(new Error("target required"), { status: 400 });
    const isUrl = /^https?:\/\//i.test(target);
    if (!isUrl) {
      // local file/folder — must be inside asset roots, the project, or be a known glb
      const resolved = path.resolve(target);
      const allowed =
        (PATHS.assetRoots || []).some((r) => {
          const root = path.resolve(r.path);
          return resolved === root || resolved.startsWith(root + path.sep);
        }) || resolved.startsWith(path.resolve(ROOT) + path.sep);
      if (!allowed) throw Object.assign(new Error("path not allowed"), { status: 403 });
      if (!(await pathExists(resolved))) throw Object.assign(new Error("not found"), { status: 404 });
    }
    if (process.platform === "win32") {
      // start "" "<arg>" via cmd.exe — empty title arg keeps spaces in path safe
      await execFileAsync("cmd.exe", ["/c", "start", "", target], { windowsHide: true });
    } else {
      await execFileAsync(process.platform === "darwin" ? "open" : "xdg-open", [target]);
    }
    return { ok: true, opened: target };
  },
  "GET /api/episodes": async () => {
    const entries = await fs.readdir(EPISODES_DIR, { withFileTypes: true }).catch(() => []);
    const episodes = [];
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      try {
        const data = JSON.parse(await fs.readFile(path.join(EPISODES_DIR, ent.name, "episode.json"), "utf8"));
        episodes.push({ id: data.id, title: data.title, updatedAt: data.updatedAt, createdAt: data.createdAt });
      } catch { /* skip bad ones */ }
    }
    episodes.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    return { ok: true, episodes };
  },
  "GET /api/voice-profiles": async () => {
    const entries = await fs.readdir(PROFILES_DIR).catch(() => []);
    const profiles = [];
    for (const name of entries) {
      if (!name.endsWith(".json")) continue;
      try {
        const data = JSON.parse(await fs.readFile(path.join(PROFILES_DIR, name), "utf8"));
        profiles.push(data);
      } catch { /* skip bad files */ }
    }
    return { ok: true, profiles };
  },
};

function safeProfileSlug(raw) {
  const s = String(raw || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 64);
  if (!s) throw Object.assign(new Error("invalid slug"), { status: 400 });
  return s;
}

function profilePath(slug) {
  return path.join(PROFILES_DIR, `${slug}.json`);
}

function defaultProfile(slug) {
  return {
    slug,
    schemaVersion: 1,
    displayName: slug,
    voiceType: "character",
    archetype: "",
    description: "",
    character: {
      tone: "",
      drawl: "",
      grit: "medium grit",
      warmth: "steady warmth",
      humor: "",
      pacing: "measured",
      accent: "",
      mood: "neutral",
    },
    tts: {
      exaggeration: 0.5,
      cfg_weight: 0.5,
    },
    playback: {
      rate: 1,
      pitch: 1,
      volume: 1,
    },
    language: "en-US",
    sampleText: "Welcome to Glitch Studio. This is a preview of the voice and the way it carries a line.",
    notes: "",
    updatedAt: null,
  };
}

function assetMimeFor(ext) {
  return ASSET_MIMES[String(ext || "").toLowerCase()] || "application/octet-stream";
}

async function readCandidates() {
  try { return JSON.parse(await fs.readFile(CANDIDATES_FILE, "utf8")); }
  catch { return []; }
}
async function writeCandidates(arr) {
  await fs.writeFile(CANDIDATES_FILE, JSON.stringify(arr, null, 2), "utf8");
}
async function discoverGlbAssets() {
  const out = [];
  for (const root of PATHS.assetRoots || []) {
    if (!(await pathExists(root.path))) continue;
    let entries;
    try { entries = await fs.readdir(root.path, { withFileTypes: true }); }
    catch { continue; }
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const ext = path.extname(ent.name).toLowerCase();
      if (ext !== ".glb" && ext !== ".gltf") continue;
      const full = path.join(root.path, ent.name);
      let size = 0;
      try { size = (await fs.stat(full)).size; } catch { /* ignore */ }
      out.push({ name: ent.name, path: full, ext, kind: "model", size, rootLabel: root.label });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

async function handleCandidateRoutes(req, url, res) {
  const m = url.pathname.match(/^\/api\/3d\/candidates\/([^/]+)$/);
  if (!m) return false;
  const id = decodeURIComponent(m[1]);
  const arr = await readCandidates();
  const idx = arr.findIndex((c) => c.id === id);
  if (idx === -1) { sendError(res, 404, "candidate not found"); return true; }

  if (req.method === "PUT" || req.method === "POST") {
    const body = await readJson(req);
    arr[idx] = {
      ...arr[idx],
      label: typeof body.label === "string" ? body.label : arr[idx].label,
      status: typeof body.status === "string" ? body.status : arr[idx].status,
      glbPath: typeof body.glbPath === "string" ? body.glbPath : arr[idx].glbPath,
      provider: typeof body.provider === "string" ? body.provider : arr[idx].provider,
      notes: typeof body.notes === "string" ? body.notes : arr[idx].notes,
      updatedAt: new Date().toISOString(),
    };
    await writeCandidates(arr);
    sendJson(res, 200, { ok: true, candidate: arr[idx] });
    return true;
  }

  if (req.method === "DELETE") {
    const removed = arr.splice(idx, 1)[0];
    await writeCandidates(arr);
    sendJson(res, 200, { ok: true, removed });
    return true;
  }

  return false;
}

async function handleAssetFile(req, url, res) {
  if (url.pathname !== "/api/assets/file" || req.method !== "GET") return false;
  const rawPath = url.searchParams.get("path") || "";
  if (!rawPath) { sendError(res, 400, "path is required"); return true; }
  const resolved = path.resolve(rawPath);
  const allowed = (PATHS.assetRoots || []).some((r) => {
    const root = path.resolve(r.path);
    return resolved === root || resolved.startsWith(root + path.sep);
  });
  if (!allowed) { sendError(res, 403, "path not under any configured asset root"); return true; }
  if (!(await pathExists(resolved))) { sendError(res, 404, "not found"); return true; }
  await streamAsset(res, resolved);
  return true;
}

const HANDOFF_TEMPLATE_HEADER = "# Glitch Studio Builder — Episode Handoff";

function buildHandoffMarkdown(ep) {
  const cast = (ep.cast || []).map((c, i) => `**${i + 1}. ${c.displayName || c.voiceSlug}** (slug: \`${c.voiceSlug}\`)\n  - Role: ${c.role || "—"}\n  - Voice mood: \`${c.moodId || "—"}\`\n  - Reference image: ${c.imagePath || "—"}\n  - 3D model: ${c.modelPath || "—"}\n  - Notes: ${c.notes || "—"}`).join("\n\n");
  const settings = (ep.settings || []).map((s, i) => `${i + 1}. **${s.label || "(unnamed)"}** — ${s.imagePath || "(no image)"}`).join("\n");
  return [
    HANDOFF_TEMPLATE_HEADER,
    "",
    `**Episode:** ${ep.title || "(untitled)"}`,
    `**ID:** ${ep.id}`,
    `**Updated:** ${ep.updatedAt || "(never saved)"}`,
    "",
    "## Cast",
    cast || "_(none)_",
    "",
    "## Settings",
    settings || "_(none)_",
    "",
    "## Director notes",
    ep.directorNotes || "_(none)_",
    "",
    "## Script",
    "```",
    String(ep.script || "").trim() || "(empty)",
    "```",
    "",
    "## Resources for the assistant",
    "- TTS engine: EnginSam Chatterbox (via Glitch sidecar `/api/tts/speak`)",
    "- Voice library: see Glitch Studio Builder → Voice Library",
    "- Mood presets per voice: see Glitch Studio Builder → Voice Workshop → Mood Library",
    "- All asset paths above are local Windows paths owned by the user.",
    "",
    "## What to do",
    "1. Read the script and the cast above.",
    "2. For each spoken line, route to the matching cast member's voice + mood.",
    "3. Match scene transitions to the listed setting images.",
    "4. Output a producer-ready breakdown: per-line voice + mood + delivery notes.",
  ].join("\n");
}

async function handleEpisodeRoutes(req, url, res) {
  const m = url.pathname.match(/^\/api\/episode\/([^/]+)(\/handoff)?$/);
  if (!m) return false;
  const id = decodeURIComponent(m[1]).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  if (!id) { sendError(res, 400, "invalid episode id"); return true; }
  const epDir = path.join(EPISODES_DIR, id);
  const epFile = path.join(epDir, "episode.json");
  const isHandoff = !!m[2];

  if (isHandoff) {
    if (req.method !== "POST") { sendError(res, 405, "use POST for handoff"); return true; }
    let ep = null;
    try { ep = JSON.parse(await fs.readFile(epFile, "utf8")); }
    catch { sendError(res, 404, "episode not saved yet"); return true; }
    const md = buildHandoffMarkdown(ep);
    const handoffMdPath = path.join(epDir, "handoff.md");
    const handoffJsonPath = path.join(epDir, "handoff.json");
    await fs.writeFile(handoffMdPath, md, "utf8");
    await fs.writeFile(handoffJsonPath, JSON.stringify({ ...ep, generatedAt: new Date().toISOString() }, null, 2), "utf8");
    sendJson(res, 200, { ok: true, handoffMdPath, handoffJsonPath, markdown: md });
    return true;
  }

  if (req.method === "GET") {
    let body;
    try { body = JSON.parse(await fs.readFile(epFile, "utf8")); }
    catch { body = null; }
    if (!body) { sendJson(res, 200, { ok: true, episode: null, exists: false, id }); return true; }
    sendJson(res, 200, { ok: true, episode: body, exists: true });
    return true;
  }

  if (req.method === "POST" || req.method === "PUT") {
    const incoming = await readJson(req);
    const now = new Date().toISOString();
    const merged = {
      id,
      title: typeof incoming.title === "string" ? incoming.title : "Untitled episode",
      directorNotes: typeof incoming.directorNotes === "string" ? incoming.directorNotes : "",
      cast: Array.isArray(incoming.cast) ? incoming.cast : [],
      settings: Array.isArray(incoming.settings) ? incoming.settings : [],
      script: typeof incoming.script === "string" ? incoming.script : "",
      claudeChat: Array.isArray(incoming.claudeChat) ? incoming.claudeChat : [],
      createdAt: incoming.createdAt || now,
      updatedAt: now,
    };
    await fs.mkdir(epDir, { recursive: true });
    await fs.writeFile(epFile, JSON.stringify(merged, null, 2), "utf8");
    sendJson(res, 200, { ok: true, episode: merged, savedTo: epFile });
    return true;
  }

  if (req.method === "DELETE") {
    try { await fs.rm(epDir, { recursive: true, force: true }); } catch { /* ignore */ }
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

async function handleClaudeChat(req, url, res) {
  if (url.pathname !== "/api/claude/chat" || req.method !== "POST") return false;
  const body = await readJson(req);
  const prompt = String(body?.prompt || "").trim();
  if (!prompt) { sendError(res, 400, "prompt is required"); return true; }
  const bin = PATHS.claudeBinary || "claude";
  const args = ["--print"];
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      input: prompt,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      timeout: 120000,
    });
    sendJson(res, 200, { ok: true, response: String(stdout || ""), stderr: String(stderr || "") });
  } catch (err) {
    const msg = err?.stderr ? String(err.stderr).slice(0, 800) : err.message;
    sendError(res, err?.code === "ENOENT" ? 404 : 500, `claude CLI failed: ${msg}`);
  }
  return true;
}

function moodOverridePath(slug, moodId) {
  const safeSlug = safeProfileSlug(slug);
  const safeMood = String(moodId || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 64);
  if (!safeMood) throw Object.assign(new Error("invalid mood id"), { status: 400 });
  return { dir: path.join(MOODS_DIR, safeSlug), file: path.join(MOODS_DIR, safeSlug, `${safeMood}.json`), safeSlug, safeMood };
}

const FX_DEFAULTS = {
  rate: 1.0,
  volume: 1.0,
  bass: 0,
  presence: 0,
  treble: 0,
  drive: 0,
  reverbMix: 0,
  delayMix: 0,
  delayTime: 250,
  stereo: 0,
  compression: 0,
};

const FX_BOUNDS = {
  rate: [0.5, 1.5],
  volume: [0, 2],
  bass: [-12, 12],
  presence: [-12, 12],
  treble: [-12, 12],
  drive: [0, 1],
  reverbMix: [0, 1],
  delayMix: [0, 1],
  delayTime: [40, 800],
  stereo: [-1, 1],
  compression: [0, 1],
};

function clampFx(input) {
  const out = { ...FX_DEFAULTS };
  if (!input || typeof input !== "object") return out;
  for (const key of Object.keys(FX_DEFAULTS)) {
    const v = Number(input[key]);
    if (!Number.isFinite(v)) continue;
    const [lo, hi] = FX_BOUNDS[key];
    out[key] = Math.max(lo, Math.min(hi, v));
  }
  return out;
}

async function handleMoodRoutes(req, url, res) {
  const m = url.pathname.match(/^\/api\/voice-mood\/([^/]+)\/([^/]+)$/);
  if (!m) return false;
  const slug = decodeURIComponent(m[1]);
  const moodId = decodeURIComponent(m[2]);
  const baseline = MOOD_BY_ID.get(moodId);
  if (!baseline) {
    sendError(res, 404, `Unknown mood: ${moodId}`);
    return true;
  }
  const { dir, file } = moodOverridePath(slug, moodId);

  if (req.method === "GET") {
    let override = null;
    try { override = JSON.parse(await fs.readFile(file, "utf8")); } catch { /* none */ }
    const merged = {
      slug, moodId,
      label: baseline.label, emoji: baseline.emoji, description: baseline.description,
      sampleText: override?.sampleText ?? baseline.sampleText,
      exaggeration: typeof override?.exaggeration === "number" ? override.exaggeration : baseline.exaggeration,
      cfg_weight: typeof override?.cfg_weight === "number" ? override.cfg_weight : baseline.cfg_weight,
      fx: clampFx(override?.fx),
      notes: override?.notes ?? "",
      isOverridden: !!override,
      updatedAt: override?.updatedAt ?? null,
    };
    sendJson(res, 200, { ok: true, mood: merged, baseline, fxDefaults: FX_DEFAULTS, fxBounds: FX_BOUNDS });
    return true;
  }

  if (req.method === "POST" || req.method === "PUT") {
    const incoming = await readJson(req);
    const overrideBody = {
      sampleText: typeof incoming.sampleText === "string" ? incoming.sampleText : baseline.sampleText,
      exaggeration: typeof incoming.exaggeration === "number" ? Math.max(0.1, Math.min(1.5, incoming.exaggeration)) : baseline.exaggeration,
      cfg_weight: typeof incoming.cfg_weight === "number" ? Math.max(0.1, Math.min(1.0, incoming.cfg_weight)) : baseline.cfg_weight,
      fx: clampFx(incoming.fx),
      notes: typeof incoming.notes === "string" ? incoming.notes : "",
      updatedAt: new Date().toISOString(),
    };
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, JSON.stringify(overrideBody, null, 2), "utf8");
    sendJson(res, 200, { ok: true, savedTo: file, mood: { slug, moodId, label: baseline.label, emoji: baseline.emoji, description: baseline.description, ...overrideBody, isOverridden: true } });
    return true;
  }

  if (req.method === "DELETE") {
    try { await fs.unlink(file); } catch (err) { if (err.code !== "ENOENT") throw err; }
    sendJson(res, 200, { ok: true, revertedTo: { slug, moodId, baseline } });
    return true;
  }

  return false;
}

async function handleProfileRoutes(req, url, res) {
  const m = url.pathname.match(/^\/api\/voice-profile\/([^/]+)$/);
  if (!m) return false;
  const slug = safeProfileSlug(decodeURIComponent(m[1]));
  const file = profilePath(slug);

  if (req.method === "GET") {
    let body;
    try { body = JSON.parse(await fs.readFile(file, "utf8")); }
    catch { body = defaultProfile(slug); }
    sendJson(res, 200, { ok: true, profile: body, exists: !!body.updatedAt });
    return true;
  }

  if (req.method === "POST" || req.method === "PUT") {
    const incoming = await readJson(req);
    const merged = {
      ...defaultProfile(slug),
      ...incoming,
      slug,
      character: { ...defaultProfile(slug).character, ...(incoming.character || {}) },
      tts: { ...defaultProfile(slug).tts, ...(incoming.tts || {}) },
      playback: { ...defaultProfile(slug).playback, ...(incoming.playback || {}) },
      updatedAt: new Date().toISOString(),
    };
    await fs.writeFile(file, JSON.stringify(merged, null, 2), "utf8");
    sendJson(res, 200, { ok: true, profile: merged, savedTo: file });
    return true;
  }

  if (req.method === "DELETE") {
    try { await fs.unlink(file); } catch (err) { if (err.code !== "ENOENT") throw err; }
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url, `http://127.0.0.1:${PATHS.sidecarPort}`);
  try {
    if (await handleAssetFile(req, url, res)) return;
    if (await handleCandidateRoutes(req, url, res)) return;
    if (await handleEpisodeRoutes(req, url, res)) return;
    if (await handleClaudeChat(req, url, res)) return;
    if (await handleMoodRoutes(req, url, res)) return;
    if (await handleProfileRoutes(req, url, res)) return;
    const key = `${req.method} ${url.pathname}`;
    const handler = ROUTES[key];
    if (!handler) { sendError(res, 404, `No route ${key}`); return; }
    const result = await handler(req, url, res);
    if (result === Symbol.for("handled")) return;
    sendJson(res, 200, result);
  } catch (err) {
    sendError(res, err?.status || 500, err?.message || String(err));
  }
});

server.listen(PATHS.sidecarPort, "127.0.0.1", () => {
  console.log(`[glitch-sidecar] http://127.0.0.1:${PATHS.sidecarPort}`);
});
