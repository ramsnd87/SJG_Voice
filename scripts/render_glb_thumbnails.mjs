#!/usr/bin/env node
// Render PNG thumbnails for .glb character models via headless Chrome + <model-viewer>.
// Usage: node scripts/render_glb_thumbnails.mjs

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const ASSET_DIR = "C:\\Users\\merin_fontvza\\OneDrive\\Desktop\\RAM SND Asset";
const OUT_DIR = path.join(ROOT, "data", "episodes", "ep_genesis", "output", "cast");
const TMP_DIR = path.join(OUT_DIR, "_tmp");
await fs.mkdir(OUT_DIR, { recursive: true });
await fs.mkdir(TMP_DIR, { recursive: true });

async function findChrome() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    `${process.env.LOCALAPPDATA || ""}\\Google\\Chrome\\Application\\chrome.exe`,
  ];
  for (const c of candidates) {
    try { await fs.access(c); return c; } catch { /* keep looking */ }
  }
  return "chrome.exe";
}

const CHARACTERS = [
  { id: "sam", glb: "SAM.glb", camera: "0deg 88deg 1.6m", label: "SAM" },
  { id: "jack", glb: "Jack.glb", camera: "0deg 88deg 1.6m", label: "Jack" },
  { id: "glitch", glb: "Glitch.glb", camera: "0deg 88deg 1.6m", label: "Glitch_Voice" },
];

const SIZE = 900;

function buildHtml(glbPath, camera) {
  const fileUri = "file:///" + glbPath.replace(/\\/g, "/");
  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
  model-viewer { width: ${SIZE}px; height: ${SIZE}px; --poster-color: transparent; background: transparent; }
</style>
<script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js"></script>
</head><body>
<model-viewer
  src="${fileUri}"
  alt="character"
  exposure="1.5"
  shadow-intensity="0"
  environment-image="neutral"
  disable-zoom
  interaction-prompt="none"
  loading="eager"
  reveal="auto"
  camera-orbit="${camera}"
  field-of-view="35deg"
></model-viewer>
</body></html>`;
}

async function renderOne(chrome, char) {
  const glbAbs = path.join(ASSET_DIR, char.glb);
  try { await fs.access(glbAbs); } catch { console.log(`[glb] missing: ${glbAbs}`); return null; }
  const html = buildHtml(glbAbs, char.camera);
  const htmlPath = path.join(TMP_DIR, `${char.id}.html`);
  await fs.writeFile(htmlPath, html, "utf8");
  const outPng = path.join(OUT_DIR, `${char.id}.png`);
  const userData = path.join(TMP_DIR, `chrome-data-${char.id}`);
  console.log(`[glb] rendering ${char.glb} → ${path.basename(outPng)}`);
  await execFileAsync(chrome, [
    "--headless=new",
    "--disable-gpu-sandbox",
    "--no-sandbox",
    "--use-gl=angle",
    "--enable-features=Vulkan",
    "--hide-scrollbars",
    `--user-data-dir=${userData}`,
    `--window-size=${SIZE},${SIZE}`,
    "--default-background-color=00000000",
    "--virtual-time-budget=20000",
    "--run-all-compositor-stages-before-draw",
    `--screenshot=${outPng}`,
    "file:///" + htmlPath.replace(/\\/g, "/"),
  ], { windowsHide: true, timeout: 60000 }).catch((err) => {
    console.log(`[glb] chrome warning for ${char.id}: ${err?.message?.slice(0, 200) || err}`);
  });
  try {
    const stat = await fs.stat(outPng);
    console.log(`[glb] ${char.id}.png ${stat.size} bytes`);
    return { id: char.id, png: outPng, size: stat.size };
  } catch { return null; }
}

const chrome = await findChrome();
console.log(`[glb] chrome: ${chrome}`);
const results = [];
for (const c of CHARACTERS) results.push(await renderOne(chrome, c));
console.log("[glb] done:", results.filter(Boolean).map((r) => `${r.id}=${r.size}B`).join(" "));
