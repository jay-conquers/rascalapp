/** Empty string means the system default output. */
export const SYSTEM_OUTPUT_DEVICE = "";

export interface OutputDeviceChoice {
  deviceId: string;
  label: string;
  /** True when the platform did not provide a device name. */
  unlabeled: boolean;
}

export interface OutputDeviceList {
  /**
   * False when outputs could not be listed.
   * A saved id is kept so playback can still try that device.
   */
  ok: boolean;
  choices: OutputDeviceChoice[];
  labelsHidden: boolean;
}

/** Chromium pseudo-devices. System default already covers them. */
const PSEUDO_OUTPUTS = new Set(["default", "communications"]);

export function sanitizeOutputDeviceId(value: string): string {
  const text = value.trim();
  if (!text || text.length > 256) return SYSTEM_OUTPUT_DEVICE;
  if (/[\u0000-\u001f\u007f]/.test(text)) return SYSTEM_OUTPUT_DEVICE;
  return text;
}

export function outputDeviceChoices(
  devices: readonly { kind?: string; deviceId?: string; label?: string }[],
): OutputDeviceChoice[] {
  const seen = new Set<string>();
  const choices: OutputDeviceChoice[] = [];
  let hidden = 0;
  for (const device of devices) {
    if (device.kind !== "audiooutput") continue;
    const deviceId = sanitizeOutputDeviceId(device.deviceId ?? "");
    if (!deviceId || PSEUDO_OUTPUTS.has(deviceId) || seen.has(deviceId)) continue;
    seen.add(deviceId);
    const label = (device.label ?? "").trim();
    const unlabeled = label.length === 0;
    if (unlabeled) hidden += 1;
    choices.push({
      deviceId,
      label: unlabeled ? `Audio output ${hidden}` : label,
      unlabeled,
    });
  }
  return choices;
}

/** `null` means the device list could not be read. */
export function outputDeviceList(
  devices: readonly { kind?: string; deviceId?: string; label?: string }[] | null,
): OutputDeviceList {
  if (!devices) return { ok: false, choices: [], labelsHidden: false };
  const choices = outputDeviceChoices(devices);
  return {
    ok: true,
    choices,
    labelsHidden: choices.length > 0 && choices.every((choice) => choice.unlabeled),
  };
}

/**
 * The id to open. An unplugged device falls back to the system default once
 * the list has been read. A failed listing keeps the saved id so a later
 * attempt can still reach it.
 */
export function resolveOutputDeviceId(savedId: string, list: OutputDeviceList): string {
  const id = sanitizeOutputDeviceId(savedId);
  if (!id) return SYSTEM_OUTPUT_DEVICE;
  if (!list.ok) return id;
  return list.choices.some((choice) => choice.deviceId === id) ? id : SYSTEM_OUTPUT_DEVICE;
}

export type SinkRoute = "audio-context" | "audio-element" | "default";

/**
 * The chime is generated in Web Audio, so the context sink is the one that
 * keeps that graph on the chosen device. The media element is the fallback
 * when the context cannot select a device.
 */
export function chooseSinkRoute(available: { audioContext: boolean; audioElement: boolean }): SinkRoute {
  if (available.audioContext) return "audio-context";
  if (available.audioElement) return "audio-element";
  return "default";
}
