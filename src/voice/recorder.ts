/**
 * Microphone recording (optionally mixed with the computer's own audio, for calls). Returns a controller
 * with a live input level, pause/resume, and stop(), which resolves to a compressed audio Blob.
 */
export interface Recording {
  stop(): Promise<Blob>;
  cancel(): void;
  pause(): void;
  resume(): void;
  level(): number; // 0..1, for a meter
  elapsed(): number; // seconds recorded, excluding pauses
  /** True when the computer's audio was captured; it is then on the right channel and the microphone on the left. */
  readonly systemAudio: boolean;
}

export class MicError extends Error {}

export async function startRecording(opts: { systemAudio?: boolean } = {}): Promise<Recording> {
  if (!navigator.mediaDevices?.getUserMedia) throw new MicError("Recording isn't available here.");
  let mic: MediaStream;
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    const name = (e as DOMException).name;
    throw new MicError(name === "NotAllowedError" ? "Microphone access was blocked. Allow it in Windows Settings → Privacy & security → Microphone." : name === "NotFoundError" ? "No microphone found." : `Couldn't start the microphone (${name}).`);
  }
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  const micNode = ctx.createMediaStreamSource(mic);
  micNode.connect(analyser);
  // Mono "funnel" nodes: downmix each source to one channel so it can be placed on its own side.
  const mono = () => { const g = ctx.createGain(); g.channelCount = 1; g.channelCountMode = "explicit"; g.channelInterpretation = "speakers"; return g; };
  const micMono = mono();
  micNode.connect(micMono);
  const extra: MediaStream[] = [];
  let systemAudio = false;
  if (opts.systemAudio && navigator.mediaDevices.getDisplayMedia) {
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
      display.getVideoTracks().forEach((t) => t.stop()); // audio only
      if (display.getAudioTracks().length) {
        const sys = ctx.createMediaStreamSource(new MediaStream(display.getAudioTracks()));
        sys.connect(analyser);
        const sysMono = mono();
        sys.connect(sysMono);
        const merger = ctx.createChannelMerger(2);
        micMono.connect(merger, 0, 0); // left: you
        sysMono.connect(merger, 0, 1); // right: the call
        dest.channelCount = 2;
        merger.connect(dest);
        systemAudio = true;
      }
      extra.push(display);
    } catch { /* user declined or not supported: microphone only */ }
  }
  if (!systemAudio) micMono.connect(dest);
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
  const rec = new MediaRecorder(dest.stream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined);
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
  rec.start(1000);
  const data = new Uint8Array(analyser.fftSize);
  const startedAt = performance.now();
  let paused = 0, pausedAt = 0;
  const release = () => {
    [mic, ...extra].forEach((s) => s.getTracks().forEach((t) => t.stop()));
    void ctx.close();
  };
  return {
    systemAudio,
    level() {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      return Math.min(1, peak / 90);
    },
    elapsed() { return ((pausedAt || performance.now()) - startedAt - paused) / 1000; },
    pause() { if (rec.state === "recording") { rec.pause(); pausedAt = performance.now(); } },
    resume() { if (rec.state === "paused") { rec.resume(); paused += performance.now() - pausedAt; pausedAt = 0; } },
    cancel() { if (rec.state !== "inactive") rec.stop(); release(); },
    stop() {
      return new Promise<Blob>((resolve) => {
        rec.onstop = () => { release(); resolve(new Blob(parts, { type: rec.mimeType || "audio/webm" })); };
        if (rec.state !== "inactive") rec.stop(); else rec.onstop?.(new Event("stop"));
      });
    },
  };
}
