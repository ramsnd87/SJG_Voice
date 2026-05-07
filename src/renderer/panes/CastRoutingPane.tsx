import React, { useEffect, useState } from "react";
import { api, type VoiceProfile } from "../lib/api";

interface CastSlot {
  id: string;
  label: string;
  voiceSlug: string;
}

const STORAGE_KEY = "gsb.castRouting.v1";

const DEFAULT_SLOTS: CastSlot[] = [
  { id: "host", label: "Host", voiceSlug: "" },
  { id: "cohost", label: "Co-host", voiceSlug: "" },
  { id: "guest", label: "Guest / Character", voiceSlug: "" },
];

export function CastRoutingPane() {
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [slots, setSlots] = useState<CastSlot[]>(() => {
    try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) return JSON.parse(raw); } catch {}
    return DEFAULT_SLOTS;
  });

  async function refresh() {
    try { const r = await api.library(); setVoices(r.voices); } catch {}
  }
  useEffect(() => { refresh(); }, []);
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(slots)); }, [slots]);

  function setSlot(idx: number, patch: Partial<CastSlot>) {
    setSlots((s) => s.map((slot, i) => i === idx ? { ...slot, ...patch } : slot));
  }
  function addSlot() {
    setSlots((s) => [...s, { id: `slot-${Date.now()}`, label: `Cast ${s.length + 1}`, voiceSlug: "" }]);
  }
  function removeSlot(idx: number) {
    setSlots((s) => s.filter((_, i) => i !== idx));
  }

  function copyJson() {
    const payload = slots.reduce<Record<string, string>>((acc, s) => { acc[s.id] = s.voiceSlug; return acc; }, {});
    navigator.clipboard?.writeText(JSON.stringify(payload, null, 2));
  }

  return (
    <div className="pane cast-routing">
      <div className="pane-header">
        <h2>Cast Routing</h2>
        <p>Plan which cloned voice plays which speaker in a show. Saved locally to this app — does not push into SAM_PODCAST until you copy the JSON over yourself.</p>
      </div>

      <section className="card">
        <h3>Slots</h3>
        <table className="cast-table">
          <thead>
            <tr><th>Label</th><th>Voice</th><th></th></tr>
          </thead>
          <tbody>
            {slots.map((slot, idx) => (
              <tr key={slot.id}>
                <td>
                  <input
                    type="text"
                    value={slot.label}
                    onChange={(e) => setSlot(idx, { label: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    value={slot.voiceSlug}
                    onChange={(e) => setSlot(idx, { voiceSlug: e.target.value })}
                  >
                    <option value="">— none —</option>
                    {voices.map((v) => (
                      <option key={v.slug} value={v.slug}>
                        {v.displayName} ({v.slug})
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button type="button" className="btn btn-ghost" onClick={() => removeSlot(idx)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row">
          <button type="button" className="btn btn-ghost" onClick={addSlot}>+ Add slot</button>
          <button type="button" className="btn btn-primary" onClick={copyJson}>Copy JSON</button>
        </div>
      </section>

      <section className="card hint">
        <h3>How to use</h3>
        <p>Once you've mapped slots → voices, copy the JSON and paste it into your podcast project's state file. This pane never writes outside Glitch_Studio_Builder.</p>
      </section>
    </div>
  );
}
