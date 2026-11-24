import fs from "node:fs";
import { isSafeSoundPath, sniffAudio } from "../shared/chat-alert";

const MAX_SOUND_BYTES = 2_000_000;

/** Read a local audio file the streamer picked. Rejects URLs and non-audio bytes. */
export function readChatSoundFile(filePath: string): { mime: string; bytes: Buffer } {
  if (!isSafeSoundPath(filePath)) throw new Error("Choose a local audio file. Remote addresses are not used.");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw new Error("That sound file could not be read.");
  }
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_SOUND_BYTES) {
    throw new Error("That sound file is empty or larger than 2 MB.");
  }
  const bytes = fs.readFileSync(filePath);
  const mime = sniffAudio(bytes);
  if (!mime) throw new Error("That file does not look like an audio file.");
  return { mime, bytes };
}
