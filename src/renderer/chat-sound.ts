import { buildChimeWav, sniffAudio } from "../shared/chat-alert";
import { chooseSinkRoute, sanitizeOutputDeviceId, type SinkRoute } from "../shared/audio-output";

let context: AudioContext | null = null;
let bundled: AudioBuffer | null = null;
let custom: { path: string; buffer: AudioBuffer } | null = null;
let chain: Promise<void> = Promise.resolve();

type SinkContext = AudioContext & { setSinkId?: (sinkId: string) => Promise<void> };
type SinkElement = HTMLAudioElement & { setSinkId?: (sinkId: string) => Promise<void> };

/**
 * Plays the message chime only.
 * TTS and redeem alerts do not call this, so the output device does not move them.
 */
export function playChatChime(input: {
  volume: number;
  soundPath?: string;
  outputDeviceId?: string;
  readFile?: (filePath: string) => Promise<Uint8Array | null>;
}): Promise<void> {
  const run = chain.then(() => playOnce(input));
  chain = run.catch(() => undefined);
  return run;
}

async function playOnce(input: {
  volume: number;
  soundPath?: string;
  outputDeviceId?: string;
  readFile?: (filePath: string) => Promise<Uint8Array | null>;
}): Promise<void> {
  const volume = Math.min(1, Math.max(0, input.volume));
  const deviceId = sanitizeOutputDeviceId(input.outputDeviceId ?? "");
  const route = currentSinkRoute();
  if (route === "audio-element") {
    try {
      await playElement(await loadChimeBytes(input.soundPath ?? "", input.readFile), volume, deviceId);
      return;
    } catch {
      // This file still plays through the context, on the default output.
    }
  }
  await playContext(volume, route === "audio-context" ? deviceId : "", input.soundPath ?? "", input.readFile);
}

function currentSinkRoute(): SinkRoute {
  return chooseSinkRoute({
    audioContext: typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype,
    audioElement: typeof HTMLAudioElement !== "undefined" && "setSinkId" in HTMLAudioElement.prototype,
  });
}

async function playContext(
  volume: number,
  deviceId: string,
  soundPath: string,
  readFile: ((filePath: string) => Promise<Uint8Array | null>) | undefined,
): Promise<void> {
  const ctx = audioContext();
  if (ctx.state === "suspended") await ctx.resume();
  await routeContext(ctx, deviceId);
  const gain = ctx.createGain();
  gain.gain.value = volume;
  gain.connect(ctx.destination);
  const buffer = await soundBuffer(ctx, soundPath, readFile);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(gain);
  source.start();
}

async function routeContext(ctx: AudioContext, deviceId: string): Promise<void> {
  const setSinkId = (ctx as SinkContext).setSinkId;
  if (typeof setSinkId !== "function") return;
  try {
    await setSinkId.call(ctx, deviceId);
  } catch {
    if (!deviceId) return;
    try {
      await setSinkId.call(ctx, "");
    } catch {
      // The context stays on the output it already has.
    }
  }
}

async function playElement(bytes: Uint8Array, volume: number, deviceId: string): Promise<void> {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const url = URL.createObjectURL(new Blob([copy], { type: sniffAudio(bytes) ?? "application/octet-stream" }));
  const audio = new Audio();
  audio.preload = "auto";
  audio.src = url;
  audio.volume = volume;
  try {
    await routeElement(audio, deviceId);
    await audio.play();
    audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

async function routeElement(audio: HTMLAudioElement, deviceId: string): Promise<void> {
  const setSinkId = (audio as SinkElement).setSinkId;
  if (typeof setSinkId !== "function") return;
  try {
    await setSinkId.call(audio, deviceId);
  } catch {
    if (!deviceId) return;
    try {
      await setSinkId.call(audio, "");
    } catch {
      // Playback continues on the default output.
    }
  }
}

function audioContext(): AudioContext {
  if (!context) context = new AudioContext();
  return context;
}

async function loadChimeBytes(
  soundPath: string,
  readFile?: (filePath: string) => Promise<Uint8Array | null>,
): Promise<Uint8Array> {
  if (soundPath && readFile) {
    const bytes = await readFile(soundPath);
    if (bytes && bytes.byteLength > 0) return bytes;
  }
  return buildChimeWav();
}

async function soundBuffer(
  ctx: AudioContext,
  soundPath: string,
  readFile?: (filePath: string) => Promise<Uint8Array | null>,
): Promise<AudioBuffer> {
  if (soundPath && readFile) {
    if (custom?.path === soundPath) return custom.buffer;
    const bytes = await readFile(soundPath);
    if (bytes && bytes.byteLength > 0) {
      const copy = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(copy).set(bytes);
      const decoded = await ctx.decodeAudioData(copy);
      custom = { path: soundPath, buffer: decoded };
      return decoded;
    }
  }
  if (!bundled) {
    const bytes = buildChimeWav();
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    bundled = await ctx.decodeAudioData(copy);
  }
  return bundled;
}
