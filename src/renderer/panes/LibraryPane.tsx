import React, { useEffect, useState } from "react";
import { api, type VoiceProfile } from "../lib/api";

export function LibraryPane() {
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [roots, setRoots] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const r = await api.library();
      setVoices(r.voices);
      setRoots(r.roots);
      setError(null);
    } catch (err: any) { setError(err.message); }
  }

  useEffect(() => { refresh(); }, []);

  return (
    <div className="pane library">
      <div className="pane-header">
        <h2>Voice Library</h2>
        <p>Read-only view of every voice profile under the configured roots. Files are never modified from this pane.</p>
      </div>

      <section className="card">
        <h3>Scan roots</h3>
        <ul className="path-list">
          {roots.map((r) => <li key={r} className="path">{r}</li>)}
        </ul>
        <button type="button" className="btn btn-ghost" onClick={refresh}>Re-scan</button>
        {error && <p className="error">{error}</p>}
      </section>

      <section className="card">
        <h3>Voices ({voices.length})</h3>
        <table className="voice-table">
          <thead>
            <tr>
              <th>Display name</th>
              <th>Slug</th>
              <th>Type</th>
              <th>Reference</th>
              <th>Profile path</th>
              <th>Policy</th>
            </tr>
          </thead>
          <tbody>
            {voices.map((v) => (
              <tr key={`${v.libraryRoot}::${v.slug}`}>
                <td>{v.displayName}</td>
                <td><code>{v.slug}</code></td>
                <td>{v.type}</td>
                <td className="path mono">{v.referenceAudio ? truncate(v.referenceAudio, 40) : "—"}</td>
                <td className="path mono">{truncate(v.profilePath, 50)}</td>
                <td>
                  {v.policy?.copyright_safe === false
                    ? <span className="tag tag-warn">IP flagged</span>
                    : <span className="tag tag-good">ok</span>}
                </td>
              </tr>
            ))}
            {voices.length === 0 && <tr><td colSpan={6} className="muted">No voices discovered.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `…${s.slice(s.length - n + 1)}`;
}
