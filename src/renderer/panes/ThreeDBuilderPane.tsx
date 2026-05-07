import React, { useEffect, useState } from "react";
import { api, type AssetItem, type GlbAsset, type ThreeDCandidate } from "../lib/api";

const PROVIDERS = [
  { id: "meshy", label: "Meshy.ai", url: "https://www.meshy.ai/workspaces/all/image-to-3d" },
  { id: "tripo", label: "Tripo3D", url: "https://www.tripo3d.ai/app" },
  { id: "luma", label: "Luma Genie", url: "https://lumalabs.ai/genie" },
  { id: "rodin", label: "Rodin (Hyper3D)", url: "https://hyper3d.ai/" },
];

const STATUS_LABELS: Record<string, string> = {
  staged: "Staged",
  sent: "Sent to tool",
  complete: "Complete",
};

const STATUS_TAG: Record<string, string> = {
  staged: "tag",
  sent: "tag tag-warn",
  complete: "tag tag-good",
};

export function ThreeDBuilderPane() {
  const [candidates, setCandidates] = useState<ThreeDCandidate[]>([]);
  const [discovered, setDiscovered] = useState<GlbAsset[]>([]);
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { reload(); reloadAssets(); }, []);

  async function reload() {
    try {
      const r = await api.listCandidates();
      setCandidates(r.candidates);
      setDiscovered(r.discoveredGlbs);
      setError(null);
    } catch (err: any) { setError(err.message); }
  }
  async function reloadAssets() {
    try {
      const roots = await api.assetRoots();
      const first = roots.roots[0];
      if (!first) return;
      const list = await api.listAssets(first.id);
      setAssets(list.items.filter((a) => a.kind === "image"));
    } catch { /* ignore */ }
  }

  async function stage(item: AssetItem) {
    try {
      const r = await api.stageCandidate(item.path, item.name.replace(/\.[^.]+$/, ""));
      setCandidates((c) => [r.candidate, ...c]);
      setPickerOpen(false);
    } catch (err: any) { setError(err.message); }
  }
  async function update(id: string, patch: Partial<ThreeDCandidate>) {
    try { const r = await api.updateCandidate(id, patch); setCandidates((cs) => cs.map((c) => c.id === id ? r.candidate : c)); }
    catch (err: any) { setError(err.message); }
  }
  async function remove(id: string) {
    if (!confirm("Remove this 3D candidate from the queue?")) return;
    try { await api.deleteCandidate(id); setCandidates((cs) => cs.filter((c) => c.id !== id)); }
    catch (err: any) { setError(err.message); }
  }
  async function attachGlb(id: string) {
    if (!window.gsb) { setError("file picker unavailable in this build"); return; }
    const p = await window.gsb.pickFile({ filters: [{ name: "3D model", extensions: ["glb", "gltf"] }] });
    if (!p) return;
    await update(id, { glbPath: p, status: "complete" });
    reload();
  }
  async function openExternal(target: string, providerId?: string) {
    try {
      await api.openExternal(target);
      if (providerId) {
        // mark all currently-staged candidates as "sent" if user clicked a provider with no candidate context
      }
    } catch (err: any) { setError(err.message); }
  }
  async function sendToProvider(provider: typeof PROVIDERS[number]) {
    await openExternal(provider.url);
  }

  return (
    <div className="pane three-d">
      <div className="pane-header">
        <h2>3D Builder</h2>
        <p>Stage images you want turned into 3D. Open them in your image-to-3D tool of choice, then attach the resulting <code>.glb</code> back. Glitch keeps the queue and links the results to your asset folder.</p>
      </div>

      <section className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h3 style={{ margin: 0 }}>Open an image-to-3D tool</h3>
            <p className="muted small">One click opens the tool's web app in your default browser. Drop the image there, generate, download the <code>.glb</code>, then come back and attach.</p>
          </div>
        </div>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {PROVIDERS.map((p) => (
            <button key={p.id} type="button" className="btn" onClick={() => sendToProvider(p)}>
              ↗ {p.label}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Candidate queue ({candidates.length})</h3>
          <button type="button" className="btn btn-primary" onClick={() => setPickerOpen(true)}>+ Stage image</button>
        </div>
        {error && <p className="error">{error}</p>}
        {candidates.length === 0 && <p className="muted">No images staged yet. Click <strong>+ Stage image</strong> to pick from RAM SND Asset.</p>}
        <div className="td-grid">
          {candidates.map((c) => (
            <div key={c.id} className="td-card">
              <div className="td-card-image">
                <img src={api.assetFileUrl(c.imagePath)} alt={c.label} />
                <span className={STATUS_TAG[c.status] || "tag"}>{STATUS_LABELS[c.status] || c.status}</span>
              </div>
              <div className="td-card-body">
                <label className="field"><span>Label</span>
                  <input type="text" value={c.label} onChange={(e) => update(c.id, { label: e.target.value })} />
                </label>
                <label className="field"><span>Tool used</span>
                  <select value={c.provider} onChange={(e) => update(c.id, { provider: e.target.value })}>
                    <option value="">— pick —</option>
                    {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </label>
                <label className="field" style={{ gridColumn: "1 / -1" }}><span>Notes</span>
                  <textarea rows={2} value={c.notes} onChange={(e) => update(c.id, { notes: e.target.value })} />
                </label>
                {c.glbPath ? (
                  <div className="td-glb-row">
                    <code className="path mono small">{c.glbPath.split(/[\\/]/).slice(-1)[0]}</code>
                    <button type="button" className="btn btn-mini" onClick={() => openExternal(c.glbPath)}>Open .glb</button>
                    <button type="button" className="btn btn-mini btn-ghost" onClick={() => attachGlb(c.id)}>Replace</button>
                  </div>
                ) : (
                  <button type="button" className="btn btn-mini" onClick={() => attachGlb(c.id)}>Attach completed .glb</button>
                )}
                <div className="row" style={{ gridColumn: "1 / -1", justifyContent: "space-between" }}>
                  <button type="button" className="btn btn-ghost btn-mini" onClick={() => update(c.id, { status: c.status === "sent" ? "staged" : "sent" })}>
                    {c.status === "sent" ? "Mark as staged" : "Mark as sent"}
                  </button>
                  <button type="button" className="btn btn-ghost btn-mini" onClick={() => remove(c.id)}>Remove</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>Existing 3D models in your asset folder ({discovered.length})</h3>
        <p className="muted small">Auto-discovered <code>.glb</code> / <code>.gltf</code> under your configured asset roots. Click to open with Windows 3D Viewer (or your default app).</p>
        <div className="td-discovered">
          {discovered.map((g) => (
            <button key={g.path} type="button" className="td-glb-tile" onClick={() => openExternal(g.path)}>
              <span className="td-glb-icon">◆</span>
              <div>
                <strong>{g.name}</strong>
                <em>{(g.size / (1024 * 1024)).toFixed(1)} MB · {g.rootLabel}</em>
              </div>
            </button>
          ))}
          {discovered.length === 0 && <p className="muted">No 3D models found yet.</p>}
        </div>
      </section>

      {pickerOpen && (
        <div className="cp-picker-overlay" onClick={() => setPickerOpen(false)}>
          <div className="cp-picker" onClick={(e) => e.stopPropagation()}>
            <header className="cp-picker-head">
              <div>
                <h3>Stage an image</h3>
                <p className="muted small">Pick an image to send through an image-to-3D tool.</p>
              </div>
              <button type="button" className="btn btn-ghost" onClick={() => setPickerOpen(false)}>Close</button>
            </header>
            <div className="cp-picker-grid">
              {assets.map((a) => (
                <button key={a.path} type="button" className="cp-picker-item" onClick={() => stage(a)}>
                  <img src={api.assetFileUrl(a.path)} alt={a.name} />
                  <span className="cp-picker-name">{a.name}</span>
                </button>
              ))}
              {assets.length === 0 && <p className="muted">No images discovered.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
