import { useEffect, useRef } from "react";
import type { MoodFx } from "./api";

interface FxNodes {
  ctx: AudioContext;
  src: MediaElementAudioSourceNode;
  drive: WaveShaperNode;
  low: BiquadFilterNode;
  mid: BiquadFilterNode;
  high: BiquadFilterNode;
  comp: DynamicsCompressorNode;
  dry: GainNode;
  reverb: ConvolverNode;
  reverbWet: GainNode;
  delay: DelayNode;
  delayFb: GainNode;
  delayWet: GainNode;
  panner: StereoPannerNode;
  master: GainNode;
}

const FX_REGISTRY = new WeakMap<HTMLAudioElement, FxNodes>();

function buildImpulseResponse(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.4);
    }
  }
  return buffer;
}

function buildDriveCurve(amount: number): Float32Array<ArrayBuffer> {
  const k = Math.max(0, amount) * 80;
  const samples = 1024;
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

function buildChain(audio: HTMLAudioElement): FxNodes | null {
  try {
    const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor() as AudioContext;
    const src = ctx.createMediaElementSource(audio);
    const drive = ctx.createWaveShaper();
    drive.oversample = "2x";
    drive.curve = buildDriveCurve(0);
    const low = ctx.createBiquadFilter();
    low.type = "lowshelf"; low.frequency.value = 250;
    const mid = ctx.createBiquadFilter();
    mid.type = "peaking"; mid.frequency.value = 2000; mid.Q.value = 1;
    const high = ctx.createBiquadFilter();
    high.type = "highshelf"; high.frequency.value = 4500;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.ratio.value = 1; comp.attack.value = 0.005; comp.release.value = 0.12;
    const dry = ctx.createGain(); dry.gain.value = 1;
    const reverb = ctx.createConvolver();
    reverb.buffer = buildImpulseResponse(ctx, 1.8);
    const reverbWet = ctx.createGain(); reverbWet.gain.value = 0;
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.25;
    const delayFb = ctx.createGain(); delayFb.gain.value = 0;
    const delayWet = ctx.createGain(); delayWet.gain.value = 0;
    const panner = ctx.createStereoPanner(); panner.pan.value = 0;
    const master = ctx.createGain(); master.gain.value = 1;

    src.connect(drive);
    drive.connect(low);
    low.connect(mid);
    mid.connect(high);
    high.connect(comp);

    comp.connect(dry); dry.connect(panner);
    comp.connect(reverb); reverb.connect(reverbWet); reverbWet.connect(panner);
    comp.connect(delay); delay.connect(delayWet); delayWet.connect(panner);
    delay.connect(delayFb); delayFb.connect(delay);

    panner.connect(master);
    master.connect(ctx.destination);

    return { ctx, src, drive, low, mid, high, comp, dry, reverb, reverbWet, delay, delayFb, delayWet, panner, master };
  } catch (err) {
    console.warn("[fx] Web Audio chain failed:", err);
    return null;
  }
}

function applyFx(nodes: FxNodes, fx: MoodFx) {
  const t = nodes.ctx.currentTime;
  const tau = 0.03;
  nodes.master.gain.setTargetAtTime(fx.volume, t, tau);
  nodes.low.gain.setTargetAtTime(fx.bass, t, tau);
  nodes.mid.gain.setTargetAtTime(fx.presence, t, tau);
  nodes.high.gain.setTargetAtTime(fx.treble, t, tau);
  nodes.drive.curve = buildDriveCurve(fx.drive);
  nodes.dry.gain.setTargetAtTime(Math.max(0, 1 - fx.reverbMix * 0.6 - fx.delayMix * 0.3), t, tau);
  nodes.reverbWet.gain.setTargetAtTime(fx.reverbMix, t, tau);
  nodes.delay.delayTime.setTargetAtTime(Math.max(0.01, fx.delayTime / 1000), t, tau);
  nodes.delayFb.gain.setTargetAtTime(fx.delayMix * 0.5, t, tau);
  nodes.delayWet.gain.setTargetAtTime(fx.delayMix, t, tau);
  nodes.panner.pan.setTargetAtTime(fx.stereo, t, tau);
  // one-knob comp: soft floor → heavy
  const threshold = -10 - 30 * fx.compression;
  const ratio = 1 + 14 * fx.compression;
  nodes.comp.threshold.setTargetAtTime(threshold, t, 0.05);
  nodes.comp.ratio.setTargetAtTime(ratio, t, 0.05);
}

export function useAudioFx(audioRef: React.RefObject<HTMLAudioElement>, fx: MoodFx) {
  const nodesRef = useRef<FxNodes | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let nodes = FX_REGISTRY.get(audio) || null;
    if (!nodes) {
      nodes = buildChain(audio);
      if (nodes) FX_REGISTRY.set(audio, nodes);
    }
    nodesRef.current = nodes;
  }, [audioRef.current]);

  useEffect(() => {
    const audio = audioRef.current;
    const nodes = nodesRef.current;
    if (audio) {
      audio.playbackRate = fx.rate;
      audio.volume = 1; // master gain handles loudness
    }
    if (nodes) {
      if (nodes.ctx.state === "suspended") nodes.ctx.resume().catch(() => undefined);
      applyFx(nodes, fx);
    }
  }, [
    fx.rate, fx.volume,
    fx.bass, fx.presence, fx.treble,
    fx.drive, fx.reverbMix,
    fx.delayMix, fx.delayTime,
    fx.stereo, fx.compression,
  ]);
}
