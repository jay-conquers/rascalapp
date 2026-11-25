import { buildChimeWav } from "../shared/chat-alert";

let context: AudioContext | null = null;
let bundled: AudioBuffer | null = null;
let custom: { path: string; buffer: AudioBuffer } | null = null;

/** Plays the chime. The window is not background-throttled, so this still runs while unfocused. */
export async function playChatChime(input: {
  volume: number;
  soundPath?: string;
  readFile?: (filePath: string) => Promise<Uint8Array | null>;
}): Promise<void> {
  const ctx = audioContext();
  if (ctx.state === "suspended") await ctx.resume();
  const gain = ctx.createGain();
  gain.gain.value = Math.min(1, Math.max(0, input.volume));
  gain.connect(ctx.destination);
  const buffer = await soundBuffer(ctx, input.soundPath ?? "", input.readFile);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(gain);
  source.start();
}

function audioContext(): AudioContext {
  if (!context) context = new AudioContext();
  return context;
}

async function soundBuffer(
  ctx: AudioContext,
  soundPath: string,
  readFile?: (filePath: string) => Promise<Uint8Array | null>,
): Promise<AudioBuffer> {
  if (soundPath && readFile) {
    if (custom?.path === soundPath) return custom.buffer;
    const bytes = await readFile(soundPath);
    if (bytes) {
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const decoded = await ctx.decodeAudioData(copy.buffer);
      custom = { path: soundPath, buffer: decoded };
      return decoded;
    }
  }
  if (!bundled) {
    const bytes = buildChimeWav();
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    bundled = await ctx.decodeAudioData(copy.buffer);
  }
  return bundled;
}
