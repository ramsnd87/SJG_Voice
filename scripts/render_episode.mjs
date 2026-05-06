#!/usr/bin/env node
// Render a Glitch Studio Builder podcast episode to MP4 (v2 pipeline).
// Usage: node scripts/render_episode.mjs <episodeJsonPath>
//
// Structure:
//   COLD OPEN  — key art "sam and jack Podcast.png" + Sam intro line + RAM logo bug
//   BRAND STING — High_Resolution_Video_Generation.mp4 (re-encoded)
//   2s HOLD    — black + center RAM logo
//   STUDIO A   — Command_Center bg + Sam & Jack cards + lines 2..5 (until "Say hello.")
//   STUDIO B   — Command_Center bg + Sam & Jack & Glitch cards + lines 6..8 (Glitch reveal + finish)
//   OUTRO      — Wisdom_for_the_Wind playout song clip with fade
//
// Audio: TTS via local sidecar /api/tts/speak (proxies EnginSam Chatterbox).
// Video: ffmpeg, all segments normalized to 1920x1080 @ 30fps, h264 + aac 48kHz stereo.

import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SIDECAR = "http://127.0.0.1:8044";

const ASSET_DIR = "C:\\Users\\merin_fontvza\\OneDrive\\Desktop\\RAM SND Asset";
const STING_MP4 = path.join(ASSET_DIR, "High_Resolution_Video_Generation.mp4");
const PLAYOUT_MP4 = path.join(ASSET_DIR, "Wisdom_for_the_Wind (2).mp4");
const BG_BODY = "C:\\Users\\merin_fontvza\\OneDrive\\Desktop\\Command_Center_PODCAST_STATION.png";
const BG_COLD = "C:\\Users\\merin_fontvza\\OneDrive\\Desktop\\sam and jack Podcast.png";
const KEYART  = "C:\\Users\\merin_fontvza\\OneDrive\\Desktop\\sam and jack Podcast.png";
const LOGO = path.join(ASSET_DIR, "RAM_Lette_Logo.png");

const W = 1920, H = 1080, FPS = 30;
const HOLD_SEC = 2;
const COLD_PAD_BEFORE = 0.6;
const COLD_PAD_AFTER = 0.55;
const STUDIO_PAD_BEFORE = 0.35;
const STUDIO_PAD_AFTER = 0.45;
const PER_LINE_GAP = 0.40;
const POST_GLITCH_BEAT = 0.35;
const OUTRO_TRIM = 8;
const OUTRO_FADE_IN = 0.5;
const OUTRO_FADE_OUT = 0.7;

const VIDEO_NORM = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${FPS}`;

async function findFfmpeg() {
  try {
    const { stdout } = await execFileAsync("where.exe", ["ffmpeg"], { windowsHide: true });
    return String(stdout).split(/\r?\n/).map((l) => l.trim()).find(Boolean) || "ffmpeg";
  } catch { return "ffmpeg"; }
}

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      timeout: 180000,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, body: JSON.parse(text) }); }
        catch { resolve({ status: res.statusCode, body: { error: text.slice(0, 400) } }); }
      });
    });
    req.on("error", reject);
    req.write(data); req.end();
  });
}
function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = []; res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
    }).on("error", reject);
  });
}

async function probeDuration(ffmpegPath, file) {
  const ffprobe = ffmpegPath.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1");
  const { stdout } = await execFileAsync(ffprobe, [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file,
  ], { windowsHide: true });
  return Number(String(stdout).trim());
}
async function ttsSpeak(voiceSlug, text, exaggeration, cfg_weight) {
  const payload = { voiceName: voiceSlug, text };
  if (typeof exaggeration === "number") payload.exaggeration = exaggeration;
  if (typeof cfg_weight === "number") payload.cfg_weight = cfg_weight;
  const r = await postJson(`${SIDECAR}/api/tts/speak`, payload);
  if (r.status !== 200 || !r.body?.audio_base64) {
    throw new Error(`TTS failed for "${voiceSlug}": ${r.body?.error || r.body?.detail || `status ${r.status}`}`);
  }
  return Buffer.from(r.body.audio_base64, "base64");
}
async function getMoodPreset(moodId) {
  if (!moodId) return null;
  const r = await getJson(`${SIDECAR}/api/voice-moods`);
  return r.moods.find((m) => m.id === moodId) || null;
}
async function ffmpeg(ffmpegPath, args, stage) {
  process.stdout.write(`[render] ${stage}\n`);
  await execFileAsync(ffmpegPath, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
}

// ── Asset prep ────────────────────────────────────────────────────────────
async function buildSamCard(ffmpegPath, outDir) {
  // Crop the left ~45% of the key art (Sam, the human host) and frame it
  const out = path.join(outDir, "sam_card.png");
  await ffmpeg(ffmpegPath, [
    "-y", "-i", KEYART,
    "-vf", "crop=iw*0.50:ih*0.55:iw*0.05:ih*0.20,scale=540:600",
    "-frames:v", "1", out,
  ], "build sam_card");
  return out;
}
async function buildJackCard(ffmpegPath, outDir) {
  // Crop the right ~45% (Jack, the donkey co-host)
  const out = path.join(outDir, "jack_card.png");
  await ffmpeg(ffmpegPath, [
    "-y", "-i", KEYART,
    "-vf", "crop=iw*0.50:ih*0.55:iw*0.45:ih*0.20,scale=540:600",
    "-frames:v", "1", out,
  ], "build jack_card");
  return out;
}
async function buildGlitchCard(ffmpegPath, outDir) {
  // Generate an ominous synth/red title card for Glitch_Voice
  const out = path.join(outDir, "glitch_card.png");
  const fontEsc = "C\\:/Windows/Fonts/Impact.ttf";
  await ffmpeg(ffmpegPath, [
    "-y",
    "-f", "lavfi", "-i", `color=c=#0a0410:s=540x600:d=1`,
    "-vf",
      `drawbox=x=0:y=0:w=540:h=600:color=#1a0410@1:t=fill,` +
      `drawbox=x=20:y=20:w=500:h=560:color=#3a0816@0.6:t=fill,` +
      `drawbox=x=20:y=20:w=500:h=560:color=#ff3050@0.85:t=2,` +
      `drawtext=fontfile='${fontEsc}':text='GLITCH':fontsize=110:fontcolor=#ff5c7a:x=(w-text_w)/2:y=h*0.30,` +
      `drawtext=fontfile='${fontEsc}':text='V O I C E':fontsize=64:fontcolor=#ffb0c0:x=(w-text_w)/2:y=h*0.50,` +
      `drawtext=text='/ synthetic intelligence':fontsize=22:fontcolor=#ff8898:x=(w-text_w)/2:y=h*0.66,` +
      `drawtext=text='[ ${"■"} ${"■"} ${"■"} ]':fontsize=28:fontcolor=#ff3050:x=(w-text_w)/2:y=h*0.78`,
    "-frames:v", "1", out,
  ], "build glitch_card");
  return out;
}

async function buildStudioComposite({ ffmpegPath, cards, outDir, name }) {
  // cards: array of { png, x, y, w, h, glow? }
  const out = path.join(outDir, `${name}.png`);
  // Build via filter chain
  let inputs = ["-loop", "1", "-t", "1", "-i", BG_BODY];
  cards.forEach((c) => { inputs.push("-i", c.png); });
  inputs.push("-i", LOGO);
  const logoIdx = cards.length + 1;
  let filter = `[0:v]${VIDEO_NORM}[bg]`;
  let prev = "bg";
  cards.forEach((c, i) => {
    const idx = i + 1;
    const tag = `c${i}`;
    const tag2 = `s${i}`;
    filter += `;[${idx}:v]scale=${c.w}:${c.h}[${tag}]`;
    filter += `;[${prev}][${tag}]overlay=${c.x}:${c.y}[${tag2}]`;
    prev = tag2;
  });
  // Add logo bug top-right
  filter += `;[${logoIdx}:v]scale=180:180:force_original_aspect_ratio=decrease[lg]`;
  filter += `;[${prev}][lg]overlay=W-w-40:40[v]`;

  await ffmpeg(ffmpegPath, [
    "-y", ...inputs,
    "-filter_complex", filter,
    "-map", "[v]",
    "-frames:v", "1",
    out,
  ], `build composite: ${name}`);
  return out;
}

// ── Audio helpers ─────────────────────────────────────────────────────────
async function buildSilence(ffmpegPath, seconds, out) {
  await ffmpeg(ffmpegPath, [
    "-y", "-f", "lavfi", "-t", String(seconds), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-c:a", "pcm_s16le", out,
  ], `silence ${seconds}s`);
}
async function concatAudios(ffmpegPath, wavs, out, tmpDir) {
  const list = path.join(tmpDir, `_audio_list_${Date.now()}.txt`);
  await fs.writeFile(list, wavs.map((w) => `file '${w.replace(/\\/g, "/")}'`).join("\n") + "\n", "utf8");
  await ffmpeg(ffmpegPath, [
    "-y", "-f", "concat", "-safe", "0", "-i", list,
    "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", out,
  ], `concat audio (${wavs.length})`);
}
async function buildBodyAudioWithGaps(ffmpegPath, lineWavs, beats, tmpDir, out) {
  // beats: [{afterSeconds}], one per gap (length = lineWavs.length - 1)
  const silenceCache = new Map();
  const sequence = [];
  for (let i = 0; i < lineWavs.length; i++) {
    sequence.push(lineWavs[i]);
    if (i < lineWavs.length - 1) {
      const dur = (beats?.[i] ?? PER_LINE_GAP);
      let sil = silenceCache.get(dur);
      if (!sil) {
        sil = path.join(tmpDir, `_silence_${dur.toFixed(2)}.wav`);
        await buildSilence(ffmpegPath, dur, sil);
        silenceCache.set(dur, sil);
      }
      sequence.push(sil);
    }
  }
  await concatAudios(ffmpegPath, sequence, out, tmpDir);
}
async function padAudio(ffmpegPath, src, before, after, out) {
  await ffmpeg(ffmpegPath, [
    "-y",
    "-f", "lavfi", "-t", String(before), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-i", src,
    "-f", "lavfi", "-t", String(after), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-filter_complex", "[0:a][1:a][2:a]concat=n=3:v=0:a=1[a]",
    "-map", "[a]", "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2",
    out,
  ], `pad ${path.basename(src)} (+${before}s before / +${after}s after)`);
}

// ── Segment builders ──────────────────────────────────────────────────────
async function buildStillSegment({ ffmpegPath, bg, audio, withLogoBug, out }) {
  const dur = await probeDuration(ffmpegPath, audio);
  const filter = withLogoBug
    ? `[0:v]${VIDEO_NORM}[bg];[1:v]scale=180:180:force_original_aspect_ratio=decrease[lg];[bg][lg]overlay=W-w-40:40[v]`
    : `[0:v]${VIDEO_NORM}[v]`;
  const args = [
    "-y", "-loop", "1", "-t", String(dur), "-i", bg,
  ];
  if (withLogoBug) args.push("-i", LOGO);
  args.push(
    "-i", audio,
    "-filter_complex", filter,
    "-map", "[v]", "-map", `${withLogoBug ? "2" : "1"}:a`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-ar", "48000", "-ac", "2",
    "-shortest", out,
  );
  await ffmpeg(ffmpegPath, args, `still segment: ${path.basename(out)}`);
}
async function buildHoldMP4(ffmpegPath, out) {
  await ffmpeg(ffmpegPath, [
    "-y",
    "-f", "lavfi", "-i", `color=c=black:s=${W}x${H}:r=${FPS}:d=${HOLD_SEC}`,
    "-loop", "1", "-i", LOGO,
    "-f", "lavfi", "-t", String(HOLD_SEC), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-filter_complex",
      `[1:v]scale=320:320:force_original_aspect_ratio=decrease[lg];` +
      `[0:v][lg]overlay=(W-w)/2:(H-h)/2[v]`,
    "-map", "[v]", "-map", "2:a",
    "-t", String(HOLD_SEC),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-ar", "48000", "-ac", "2",
    out,
  ], "build 2s hold");
}
async function buildStingMP4(ffmpegPath, out) {
  // Re-encode brand sting to canonical spec; preserve audio if present, else attach silent
  await ffmpeg(ffmpegPath, [
    "-y", "-i", STING_MP4,
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-filter_complex", `[0:v]${VIDEO_NORM}[v]`,
    "-map", "[v]", "-map", "0:a?", "-map", "1:a",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-ar", "48000", "-ac", "2",
    "-shortest",
    out,
  ], "normalize brand sting").catch(async () => {
    await ffmpeg(ffmpegPath, [
      "-y", "-i", STING_MP4,
      "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-filter_complex", `[0:v]${VIDEO_NORM}[v]`,
      "-map", "[v]", "-map", "1:a",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", String(FPS),
      "-c:a", "aac", "-ar", "48000", "-ac", "2",
      "-shortest", out,
    ], "normalize brand sting (silent fallback)");
  });
}
async function buildOutroMP4(ffmpegPath, out) {
  const trim = OUTRO_TRIM;
  const fadeOutStart = trim - OUTRO_FADE_OUT;
  await ffmpeg(ffmpegPath, [
    "-y", "-i", PLAYOUT_MP4,
    "-t", String(trim),
    "-filter_complex",
      `[0:v]${VIDEO_NORM},fade=t=in:st=0:d=${OUTRO_FADE_IN},fade=t=out:st=${fadeOutStart}:d=${OUTRO_FADE_OUT}[v];` +
      `[0:a]afade=t=in:st=0:d=${OUTRO_FADE_IN},afade=t=out:st=${fadeOutStart}:d=${OUTRO_FADE_OUT}[a]`,
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-ar", "48000", "-ac", "2",
    "-t", String(trim),
    out,
  ], "build playout outro");
}

async function concatMP4s(ffmpegPath, parts, out) {
  const inputs = []; parts.forEach((p) => { inputs.push("-i", p); });
  const fc = parts.map((_, i) => `[${i}:v][${i}:a]`).join("") + `concat=n=${parts.length}:v=1:a=1[v][a]`;
  await ffmpeg(ffmpegPath, [
    "-y", ...inputs,
    "-filter_complex", fc,
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart",
    out,
  ], "final concat");
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  const epPathArg = process.argv[2];
  if (!epPathArg) throw new Error("Usage: render_episode.mjs <episodeJsonPath>");
  const epPath = path.resolve(epPathArg);
  const ep = JSON.parse(await fs.readFile(epPath, "utf8"));
  const epDir = path.dirname(epPath);
  const outDir = path.join(epDir, "output");
  const audioDir = path.join(outDir, "audio");
  const tmpDir = path.join(outDir, "tmp");
  const cardsDir = path.join(outDir, "cards");
  await fs.mkdir(audioDir, { recursive: true });
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.mkdir(cardsDir, { recursive: true });

  const ffmpegPath = await findFfmpeg();
  console.log(`[render] ffmpeg: ${ffmpegPath}`);

  // 1) TTS each line.
  const lines = ep.renderLines || [];
  if (lines.length < 6) throw new Error("episode JSON expects at least 6 renderLines for v2 pipeline");
  const lineWavs = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const mood = await getMoodPreset(l.moodId);
    const wav = path.join(audioDir, `line_${String(i + 1).padStart(2, "0")}_${l.voiceSlug}.wav`);
    process.stdout.write(`[render] TTS line ${i + 1}/${lines.length}: ${l.voiceSlug} (${l.moodId})\n`);
    const buf = await ttsSpeak(l.voiceSlug, l.text, mood?.exaggeration, mood?.cfg_weight);
    await fs.writeFile(wav, buf);
    lineWavs.push(wav);
  }

  // 2) Build character cards
  const samCard = await buildSamCard(ffmpegPath, cardsDir);
  const jackCard = await buildJackCard(ffmpegPath, cardsDir);
  const glitchCard = await buildGlitchCard(ffmpegPath, cardsDir);

  // 3) Build studio composites
  // Layout: bottom row of three cards, 540x600 each, left/center/right
  const cardW = 460, cardH = 510;
  const cardY = H - cardH - 40;
  const leftX = 100, midX = (W - cardW) / 2, rightX = W - cardW - 100;

  // Studio A — Sam (left) + Jack (right)
  const studioA = await buildStudioComposite({
    ffmpegPath, outDir: cardsDir, name: "studio_a",
    cards: [
      { png: samCard, x: leftX, y: cardY, w: cardW, h: cardH },
      { png: jackCard, x: rightX, y: cardY, w: cardW, h: cardH },
    ],
  });

  // Studio B — Sam + Jack + Glitch (center)
  const studioB = await buildStudioComposite({
    ffmpegPath, outDir: cardsDir, name: "studio_b",
    cards: [
      { png: samCard, x: leftX, y: cardY, w: cardW, h: cardH },
      { png: glitchCard, x: midX, y: cardY, w: cardW, h: cardH },
      { png: jackCard, x: rightX, y: cardY, w: cardW, h: cardH },
    ],
  });

  // 4) Cold open: line 1 with key art + logo bug
  const coldPadded = path.join(tmpDir, "cold_padded.wav");
  await padAudio(ffmpegPath, lineWavs[0], COLD_PAD_BEFORE, COLD_PAD_AFTER, coldPadded);
  const coldMp4 = path.join(tmpDir, "01_cold.mp4");
  await buildStillSegment({ ffmpegPath, bg: BG_COLD, audio: coldPadded, withLogoBug: true, out: coldMp4 });

  // 5) Brand sting
  const stingMp4 = path.join(tmpDir, "02_sting.mp4");
  await buildStingMP4(ffmpegPath, stingMp4);

  // 6) 2s hold
  const holdMp4 = path.join(tmpDir, "03_hold.mp4");
  await buildHoldMP4(ffmpegPath, holdMp4);

  // 7) Studio A body — lines 2..5 over Sam+Jack composite
  // Default per-line gap, slightly longer after line 5 to set up the Glitch reveal
  const studioALineWavs = lineWavs.slice(1, 5); // lines 2..5
  const studioAGaps = [PER_LINE_GAP, PER_LINE_GAP, PER_LINE_GAP + 0.15]; // gaps between 2-3, 3-4, 4-5
  const studioAJoined = path.join(tmpDir, "studio_a_audio.wav");
  await buildBodyAudioWithGaps(ffmpegPath, studioALineWavs, studioAGaps, tmpDir, studioAJoined);
  const studioAPadded = path.join(tmpDir, "studio_a_padded.wav");
  await padAudio(ffmpegPath, studioAJoined, STUDIO_PAD_BEFORE, 0.5, studioAPadded);
  const studioAMp4 = path.join(tmpDir, "04_studio_a.mp4");
  await buildStillSegment({ ffmpegPath, bg: studioA, audio: studioAPadded, withLogoBug: false, out: studioAMp4 });

  // 8) Studio B body — lines 6..N over Sam+Jack+Glitch composite (Glitch reveal)
  const studioBLineWavs = lineWavs.slice(5);
  // Insert a small extra beat after Glitch's line (line 6 = index 0 in this slice)
  const studioBGaps = [];
  for (let i = 0; i < studioBLineWavs.length - 1; i++) {
    studioBGaps.push(i === 0 ? POST_GLITCH_BEAT + PER_LINE_GAP : PER_LINE_GAP);
  }
  const studioBJoined = path.join(tmpDir, "studio_b_audio.wav");
  await buildBodyAudioWithGaps(ffmpegPath, studioBLineWavs, studioBGaps, tmpDir, studioBJoined);
  const studioBPadded = path.join(tmpDir, "studio_b_padded.wav");
  await padAudio(ffmpegPath, studioBJoined, STUDIO_PAD_BEFORE, STUDIO_PAD_AFTER, studioBPadded);
  const studioBMp4 = path.join(tmpDir, "05_studio_b.mp4");
  await buildStillSegment({ ffmpegPath, bg: studioB, audio: studioBPadded, withLogoBug: false, out: studioBMp4 });

  // 9) Outro playout song
  const outroMp4 = path.join(tmpDir, "06_outro.mp4");
  await buildOutroMP4(ffmpegPath, outroMp4);

  // 10) Final concat
  const finalMp4 = path.join(outDir, `${ep.id}.mp4`);
  await concatMP4s(ffmpegPath, [coldMp4, stingMp4, holdMp4, studioAMp4, studioBMp4, outroMp4], finalMp4);

  const dur = await probeDuration(ffmpegPath, finalMp4);
  const stat = await fs.stat(finalMp4);
  console.log(`[render] DONE: ${finalMp4}`);
  console.log(`[render] duration=${dur.toFixed(2)}s size=${(stat.size / (1024 * 1024)).toFixed(1)} MB`);
  console.log(JSON.stringify({ ok: true, mp4: finalMp4, durationSeconds: dur, sizeBytes: stat.size }));
}

main().catch((err) => {
  console.error("[render] FAILED:", err.message);
  process.exit(1);
});
