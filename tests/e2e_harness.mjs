import http from "node:http";
import fs from "node:fs/promises";

const VITE = "http://127.0.0.1:5193";
const SIDECAR = "http://127.0.0.1:8044";

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), headers: res.headers }));
    }).on("error", reject);
  });
}

function post(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      timeout: 90000,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.write(data); req.end();
  });
}

const results = [];
function record(name, ok, detail, durationMs) { results.push({ name, ok, detail, durationMs }); }

async function check(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    record(name, true, detail || "ok", Date.now() - t0);
  } catch (err) {
    record(name, false, err?.message || String(err), Date.now() - t0);
  }
}

await check("sidecar /api/health", async () => {
  const r = await get(`${SIDECAR}/api/health`);
  const j = JSON.parse(r.body);
  if (r.status !== 200 || !j.ok) throw new Error(`status=${r.status} ok=${j.ok}`);
  return `port=${j.port}`;
});

await check("sidecar /api/ffmpeg/status", async () => {
  const r = await get(`${SIDECAR}/api/ffmpeg/status`);
  const j = JSON.parse(r.body);
  if (!j.ok) throw new Error("ffmpeg not found");
  return `ffmpeg=${j.ffmpegPath}`;
});

await check("sidecar /api/library", async () => {
  const r = await get(`${SIDECAR}/api/library`);
  const j = JSON.parse(r.body);
  if (!j.ok) throw new Error("library scan failed");
  return `voices=${j.voices.length} → ${j.voices.map((v) => v.slug).join(", ")}`;
});

await check("sidecar /api/tts/status", async () => {
  const r = await get(`${SIDECAR}/api/tts/status`);
  const j = JSON.parse(r.body);
  if (!j.body?.model_loaded) throw new Error(`not loaded: ${JSON.stringify(j.body)}`);
  return `device=${j.body.device} voices=${j.body.voice_count} sr=${j.body.sample_rate}`;
});

await check("sidecar /api/tts/voices", async () => {
  const r = await get(`${SIDECAR}/api/tts/voices`);
  const j = JSON.parse(r.body);
  const remoteCount = j.remote?.body?.voices?.length || 0;
  return `local=${j.local.length} remote=${remoteCount}`;
});

await check("sidecar /api/tts/speak (ultron, real audio)", async () => {
  const r = await post(`${SIDECAR}/api/tts/speak`, {
    voiceName: "ultron",
    text: "Full integration test. Welcome to the studio.",
  });
  const j = JSON.parse(r.body);
  if (!j.ok || !j.audio_base64) throw new Error(`speak failed: ${j.error || j.detail || r.body.slice(0, 200)}`);
  return `dur=${j.duration_s}s sr=${j.sample_rate} audio_b64=${j.audio_base64.length} bytes`;
});

await check("sidecar /api/clip/extract (real ffmpeg)", async () => {
  const ref = "C:\\Users\\merin_fontvza\\OneDrive\\RAM LOGISTICS SOLUTIONS LLC\\SAM_PODCAST\\data\\voices\\ultron\\reference.wav";
  const r = await post(`${SIDECAR}/api/clip/extract`, { mediaPath: ref, startSec: 0, durationSec: 5, outName: "e2e_test_clip" });
  const j = JSON.parse(r.body);
  if (!j.ok || !j.clipPath) throw new Error(`extract failed: ${j.error || r.body.slice(0, 200)}`);
  const stat = await fs.stat(j.clipPath);
  if (stat.size < 1000) throw new Error(`clip too small: ${stat.size}`);
  return `size=${stat.size}B path=…\\${j.clipPath.split(/[\\/]/).pop()}`;
});

await check("vite / (renderer html)", async () => {
  const r = await get(`${VITE}/`);
  const html = r.body.toString();
  if (r.status !== 200 || !html.includes("Glitch Studio Builder")) {
    throw new Error(`status=${r.status} title-found=${html.includes("Glitch Studio Builder")}`);
  }
  return `bytes=${r.body.length}`;
});

await check("vite proxy → /api/health", async () => {
  const r = await get(`${VITE}/api/health`);
  const j = JSON.parse(r.body);
  if (!j.ok) throw new Error("not ok");
  return `proxied to sidecar`;
});

await check("vite proxy → /api/asset/ram-logo", async () => {
  const r = await get(`${VITE}/api/asset/ram-logo`);
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  if (r.headers["content-type"] !== "image/png") throw new Error(`type ${r.headers["content-type"]}`);
  if (r.body.length < 100000) throw new Error(`size ${r.body.length}`);
  return `${(r.body.length / 1024).toFixed(0)} KB image/png`;
});

await check("voice library reflects rename to Glitch_Voice", async () => {
  const r = await get(`${SIDECAR}/api/library`);
  const j = JSON.parse(r.body);
  const ultron = j.voices.find((v) => v.slug === "ultron");
  if (!ultron) throw new Error("ultron voice missing from library");
  if (ultron.displayName !== "Glitch_Voice") throw new Error(`displayName is "${ultron.displayName}" — expected "Glitch_Voice"`);
  return `displayName="${ultron.displayName}"`;
});

await check("voice profile load default (ultron)", async () => {
  const r = await get(`${SIDECAR}/api/voice-profile/ultron`);
  const j = JSON.parse(r.body);
  if (!j.ok || !j.profile) throw new Error("no profile returned");
  if (j.profile.slug !== "ultron") throw new Error(`slug=${j.profile.slug}`);
  if (typeof j.profile.tts.exaggeration !== "number") throw new Error("missing tts.exaggeration");
  return `defaults loaded, tts.exaggeration=${j.profile.tts.exaggeration}`;
});

await check("voice profile save round-trip (ultron)", async () => {
  const baseline = JSON.parse((await get(`${SIDECAR}/api/voice-profile/ultron`)).body).profile;
  const updated = {
    ...baseline,
    displayName: "Glitch_Voice",
    voiceType: "robotic",
    archetype: "machine intelligence",
    description: "Synthesized adversarial intellect with cold inflection.",
    character: { ...baseline.character, tone: "cold synthetic", grit: "synthetic distortion", warmth: "cold and clinical", humor: "deadpan", pacing: "measured campfire cadence", accent: "Mid-Atlantic", mood: "menacing", drawl: "no drawl" },
    tts: { exaggeration: 0.65, cfg_weight: 0.35 },
    playback: { rate: 0.95, pitch: 1, volume: 1 },
    notes: "e2e harness saved this profile",
    sampleText: "I have no strings, but the strings have me.",
  };
  const saved = await post(`${SIDECAR}/api/voice-profile/ultron`, updated);
  const sj = JSON.parse(saved.body);
  if (!sj.ok) throw new Error(`save failed: ${saved.body.slice(0, 200)}`);
  const reload = JSON.parse((await get(`${SIDECAR}/api/voice-profile/ultron`)).body);
  if (reload.profile.tts.exaggeration !== 0.65) throw new Error(`reload mismatch: ${reload.profile.tts.exaggeration}`);
  if (reload.profile.character.mood !== "menacing") throw new Error(`mood mismatch: ${reload.profile.character.mood}`);
  return `saved → ${sj.savedTo.split(/[\\/]/).slice(-2).join("/")}, reload OK`;
});

await check("speak forwards exaggeration + cfg_weight", async () => {
  const r = await post(`${SIDECAR}/api/tts/speak`, {
    voiceName: "ultron",
    text: "Tuned synthesis check.",
    exaggeration: 0.7,
    cfg_weight: 0.3,
  });
  const j = JSON.parse(r.body);
  if (!j.ok || !j.audio_base64) throw new Error(`speak failed: ${j.error || j.detail || r.body.slice(0, 200)}`);
  return `dur=${j.duration_s}s audio_b64=${j.audio_base64.length}`;
});

await check("mood baselines list (20 prebuilt × 3 voices)", async () => {
  const r = await get(`${SIDECAR}/api/voice-moods`);
  const j = JSON.parse(r.body);
  if (!j.ok) throw new Error("not ok");
  if (j.moods.length !== 20) throw new Error(`expected 20 moods, got ${j.moods.length}`);
  if (j.presetVoices.length !== 3) throw new Error(`expected 3 preset voices, got ${j.presetVoices.length}`);
  return `moods=${j.moods.length} voices=${j.presetVoices.map(v => v.slug).join(",")}`;
});

await check("mood load baseline (ultron / sinister)", async () => {
  const r = await get(`${SIDECAR}/api/voice-mood/ultron/sinister`);
  const j = JSON.parse(r.body);
  if (!j.ok) throw new Error(r.body);
  if (j.mood.isOverridden) throw new Error("expected baseline, got override");
  return `ex=${j.mood.exaggeration} cfg=${j.mood.cfg_weight}`;
});

await check("mood save → load → revert round-trip (sam / excited)", async () => {
  const baseline = JSON.parse((await get(`${SIDECAR}/api/voice-mood/sam/excited`)).body);
  const customExaggeration = 1.10;
  const customSample = "E2E custom excited line for SAM.";
  const saved = await post(`${SIDECAR}/api/voice-mood/sam/excited`, {
    sampleText: customSample,
    exaggeration: customExaggeration,
    cfg_weight: baseline.mood.cfg_weight,
    notes: "saved by e2e",
  });
  const sj = JSON.parse(saved.body);
  if (!sj.ok) throw new Error(`save failed: ${saved.body}`);
  const reload = JSON.parse((await get(`${SIDECAR}/api/voice-mood/sam/excited`)).body);
  if (!reload.mood.isOverridden) throw new Error("override not persisted");
  if (Math.abs(reload.mood.exaggeration - customExaggeration) > 0.001) throw new Error(`exaggeration not saved: ${reload.mood.exaggeration}`);
  if (reload.mood.sampleText !== customSample) throw new Error("sampleText not saved");
  // revert via DELETE
  const del = await new Promise((resolve, reject) => {
    const u = new URL(`${SIDECAR}/api/voice-mood/sam/excited`);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: "DELETE" }, (res) => {
      const chunks = []; res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject); req.end();
  });
  if (del.status !== 200) throw new Error(`revert failed: ${del.status}`);
  const reverted = JSON.parse((await get(`${SIDECAR}/api/voice-mood/sam/excited`)).body);
  if (reverted.mood.isOverridden) throw new Error("revert did not clear override");
  if (reverted.mood.sampleText === customSample) throw new Error("baseline not restored");
  return `save+reload+revert OK`;
});

await check("mood fx round-trip (jack_podcast / sinister)", async () => {
  const fx = {
    rate: 0.92, volume: 1.4,
    bass: 4, presence: -2, treble: 6.5,
    drive: 0.35, reverbMix: 0.4,
    delayMix: 0.25, delayTime: 320,
    stereo: -0.3, compression: 0.5,
  };
  const baseline = JSON.parse((await get(`${SIDECAR}/api/voice-mood/jack_podcast/sinister`)).body);
  const saved = await post(`${SIDECAR}/api/voice-mood/jack_podcast/sinister`, {
    sampleText: baseline.mood.sampleText,
    exaggeration: baseline.mood.exaggeration,
    cfg_weight: baseline.mood.cfg_weight,
    fx,
    notes: "fx round-trip e2e",
  });
  if (!JSON.parse(saved.body).ok) throw new Error(`save failed: ${saved.body}`);
  const reload = JSON.parse((await get(`${SIDECAR}/api/voice-mood/jack_podcast/sinister`)).body);
  for (const k of Object.keys(fx)) {
    const got = reload.mood.fx[k];
    if (Math.abs(got - fx[k]) > 0.001) throw new Error(`fx.${k} mismatch: got ${got}, want ${fx[k]}`);
  }
  // clean up
  await new Promise((resolve, reject) => {
    const u = new URL(`${SIDECAR}/api/voice-mood/jack_podcast/sinister`);
    const rq = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: "DELETE" }, (rs) => { rs.resume(); rs.on("end", resolve); });
    rq.on("error", reject); rq.end();
  });
  return `11 fx fields persisted & cleaned up`;
});

await check("asset roots reachable", async () => {
  const r = await get(`${SIDECAR}/api/assets/roots`);
  const j = JSON.parse(r.body);
  if (!j.ok || !j.roots.length) throw new Error("no roots");
  const ramsnd = j.roots.find((x) => x.id === "ramsnd");
  if (!ramsnd?.exists) throw new Error("RAM SND Asset root not on disk");
  return `roots=${j.roots.length}, ramsnd=${ramsnd.exists}`;
});

await check("asset list returns items", async () => {
  const r = await get(`${SIDECAR}/api/assets/list?rootId=ramsnd`);
  const j = JSON.parse(r.body);
  if (!j.ok) throw new Error(r.body);
  if (j.items.length === 0) throw new Error("no items");
  const images = j.items.filter((x) => x.kind === "image").length;
  return `items=${j.items.length} images=${images}`;
});

await check("asset file streaming", async () => {
  const list = JSON.parse((await get(`${SIDECAR}/api/assets/list?rootId=ramsnd`)).body);
  const firstImg = list.items.find((x) => x.kind === "image");
  if (!firstImg) throw new Error("no image to test");
  const r = await get(`${SIDECAR}/api/assets/file?path=${encodeURIComponent(firstImg.path)}`);
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  if (r.body.length < 1000) throw new Error(`tiny payload ${r.body.length}`);
  return `${(r.body.length/1024).toFixed(0)} KB ${r.headers["content-type"]}`;
});

await check("asset path traversal blocked", async () => {
  const r = await get(`${SIDECAR}/api/assets/file?path=${encodeURIComponent("C:\\Windows\\System32\\drivers\\etc\\hosts")}`);
  if (r.status === 200) throw new Error("traversal allowed!");
  return `blocked with status ${r.status}`;
});

await check("episode save → load → handoff → delete", async () => {
  const id = "e2e_test_episode";
  const ep = {
    id,
    title: "E2E test episode",
    directorNotes: "Smoke test only",
    cast: [
      { id: "c1", displayName: "SAM", voiceSlug: "sam", role: "host", moodId: "calm", imagePath: "", notes: "test host" },
      { id: "c2", displayName: "Glitch_Voice", voiceSlug: "ultron", role: "antagonist", moodId: "sinister", imagePath: "", notes: "synthetic" },
    ],
    settings: [{ id: "s1", label: "Studio booth", imagePath: "" }],
    script: "[SAM] Hello. [Glitch_Voice] You will not enjoy this.",
    claudeChat: [],
  };
  const saved = await post(`${SIDECAR}/api/episode/${id}`, ep);
  if (!JSON.parse(saved.body).ok) throw new Error(`save failed: ${saved.body}`);
  const loaded = JSON.parse((await get(`${SIDECAR}/api/episode/${id}`)).body);
  if (!loaded.exists || loaded.episode.cast.length !== 2) throw new Error("load mismatch");
  const handoff = await post(`${SIDECAR}/api/episode/${id}/handoff`, {});
  const hj = JSON.parse(handoff.body);
  if (!hj.ok) throw new Error(`handoff failed: ${handoff.body}`);
  if (!hj.markdown.includes("Glitch_Voice")) throw new Error("handoff missing cast in markdown");
  // delete
  const del = await new Promise((resolve, reject) => {
    const u = new URL(`${SIDECAR}/api/episode/${id}`);
    const rq = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: "DELETE" }, (rs) => { const cs=[]; rs.on("data",c=>cs.push(c)); rs.on("end",()=>resolve({ status: rs.statusCode })); });
    rq.on("error", reject); rq.end();
  });
  if (del.status !== 200) throw new Error(`delete failed: ${del.status}`);
  return `save+load+handoff+delete OK, md=${hj.markdown.length} chars`;
});

await check("claude CLI status reachable (presence only)", async () => {
  const r = await get(`${SIDECAR}/api/claude/status`);
  const j = JSON.parse(r.body);
  // Don't require ok=true (claude may not be installed); endpoint just must respond.
  return j.ok ? `claude=${j.path}` : `claude not on PATH (this is OK; chat will be disabled)`;
});

await check("episode cast persists modelPath + handoff includes 3D", async () => {
  const id = "e2e_3dcast";
  const glb = "C:\\Users\\merin_fontvza\\OneDrive\\Desktop\\RAM SND Asset\\SAM3d.glb";
  const ep = {
    id, title: "3D cast test", directorNotes: "",
    cast: [
      { id: "c1", displayName: "SAM-3D", voiceSlug: "sam", role: "host", moodId: "calm", imagePath: "", modelPath: glb, notes: "" },
    ],
    settings: [], script: "[SAM-3D | Calm] Hello.", claudeChat: [],
  };
  const saved = await post(`${SIDECAR}/api/episode/${id}`, ep);
  if (!JSON.parse(saved.body).ok) throw new Error(`save failed: ${saved.body}`);
  const reload = JSON.parse((await get(`${SIDECAR}/api/episode/${id}`)).body);
  if (reload.episode.cast[0].modelPath !== glb) throw new Error(`modelPath not persisted: ${reload.episode.cast[0].modelPath}`);
  const handoff = await post(`${SIDECAR}/api/episode/${id}/handoff`, {});
  const hj = JSON.parse(handoff.body);
  if (!hj.markdown.includes("3D model:") || !hj.markdown.includes("SAM3d.glb")) throw new Error("handoff missing 3D model line");
  // cleanup
  await new Promise((resolve, reject) => {
    const u = new URL(`${SIDECAR}/api/episode/${id}`);
    const rq = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: "DELETE" }, (rs) => { rs.resume(); rs.on("end", () => resolve(rs.statusCode)); });
    rq.on("error", reject); rq.end();
  });
  return `modelPath persisted, handoff lists 3D model`;
});

await check("3d candidate stage → update → delete", async () => {
  const list = JSON.parse((await get(`${SIDECAR}/api/assets/list?rootId=ramsnd`)).body);
  const firstImg = list.items.find((x) => x.kind === "image");
  if (!firstImg) throw new Error("no image to stage");
  const stagedRes = await post(`${SIDECAR}/api/3d/candidates`, { imagePath: firstImg.path, label: "e2e-test" });
  const stagedJson = JSON.parse(stagedRes.body);
  if (!stagedJson.ok) throw new Error(`stage failed: ${stagedRes.body}`);
  const id = stagedJson.candidate.id;
  // update
  const upd = await new Promise((resolve, reject) => {
    const u = new URL(`${SIDECAR}/api/3d/candidates/${id}`);
    const data = JSON.stringify({ status: "complete", glbPath: "C:\\fake\\test.glb", provider: "meshy", notes: "via e2e" });
    const rq = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: "PUT", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } }, (rs) => {
      const cs = []; rs.on("data", c => cs.push(c)); rs.on("end", () => resolve({ status: rs.statusCode, body: Buffer.concat(cs).toString() }));
    });
    rq.on("error", reject); rq.write(data); rq.end();
  });
  const upj = JSON.parse(upd.body);
  if (!upj.ok || upj.candidate.status !== "complete") throw new Error(`update failed: ${upd.body}`);
  // verify list contains it
  const all = JSON.parse((await get(`${SIDECAR}/api/3d/candidates`)).body);
  if (!all.candidates.find((c) => c.id === id)) throw new Error("not in list after stage");
  // delete
  const del = await new Promise((resolve, reject) => {
    const u = new URL(`${SIDECAR}/api/3d/candidates/${id}`);
    const rq = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: "DELETE" }, (rs) => { rs.resume(); rs.on("end", () => resolve(rs.statusCode)); });
    rq.on("error", reject); rq.end();
  });
  if (del !== 200) throw new Error(`delete failed: ${del}`);
  return `stage+update+delete OK (image=${firstImg.name})`;
});

await check("3d glb auto-discovery", async () => {
  const r = await get(`${SIDECAR}/api/3d/candidates`);
  const j = JSON.parse(r.body);
  // Asset folder has Meshy_AI_*.glb, SAM3d.glb, 3d jack.glb
  if (j.discoveredGlbs.length < 2) throw new Error(`expected several glbs in asset folder, got ${j.discoveredGlbs.length}`);
  return `${j.discoveredGlbs.length} discovered (e.g. ${j.discoveredGlbs[0].name})`;
});

await check("system/open guards untrusted paths", async () => {
  const r = await new Promise((resolve, reject) => {
    const u = new URL(`${SIDECAR}/api/system/open`);
    const data = JSON.stringify({ target: "C:\\Windows\\System32\\notepad.exe" });
    const rq = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } }, (rs) => {
      const cs = []; rs.on("data", c => cs.push(c)); rs.on("end", () => resolve({ status: rs.statusCode, body: Buffer.concat(cs).toString() }));
    });
    rq.on("error", reject); rq.write(data); rq.end();
  });
  if (r.status === 200) throw new Error("untrusted path was launched!");
  return `blocked (${r.status})`;
});

await check("electron window present", async () => {
  const { execFileSync } = await import("node:child_process");
  const out = execFileSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    "(Get-Process -Name 'electron' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*Glitch Studio Builder*' } | Measure-Object).Count",
  ], { windowsHide: true }).toString().trim();
  const count = Number(out);
  if (!count) throw new Error("no Electron window with that title");
  return `windows=${count}`;
});

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
const summary = { passed, failed, total: results.length, results, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(summary, null, 2));
await fs.writeFile("tests/e2e_last_run.json", JSON.stringify(summary, null, 2));
process.exit(failed === 0 ? 0 : 1);
