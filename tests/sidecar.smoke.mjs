import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIDECAR = path.resolve(__dirname, "..", "src", "sidecar", "index.mjs");

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    }).on("error", reject);
  });
}

async function waitFor(url, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { return await get(url); } catch { await new Promise((r) => setTimeout(r, 120)); }
  }
  throw new Error(`Timed out waiting for ${url}`);
}

test("sidecar boots and reports health", async () => {
  const child = spawn(process.execPath, [SIDECAR], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const r = await waitFor("http://127.0.0.1:8044/api/health");
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.sidecar, "glitch-studio-builder");
  } finally {
    child.kill();
  }
});

test("sidecar lists local voices without crashing when TTS is down", async () => {
  const child = spawn(process.execPath, [SIDECAR], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await waitFor("http://127.0.0.1:8044/api/health");
    const r = await get("http://127.0.0.1:8044/api/library");
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.ok(Array.isArray(r.body.voices));
  } finally {
    child.kill();
  }
});
