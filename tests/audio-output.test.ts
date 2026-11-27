import { describe, expect, it } from "vitest";
import {
  chooseSinkRoute,
  outputDeviceChoices,
  outputDeviceList,
  resolveOutputDeviceId,
  sanitizeOutputDeviceId,
} from "../src/shared/audio-output";

describe("alert output devices", () => {
  it("lists real outputs, names unlabeled ones, and skips the system pseudo devices", () => {
    const choices = outputDeviceChoices([
      { kind: "audioinput", deviceId: "mic", label: "Mic" },
      { kind: "audiooutput", deviceId: "default", label: "Default - Speakers" },
      { kind: "audiooutput", deviceId: "communications", label: "Communications" },
      { kind: "audiooutput", deviceId: "", label: "Hidden" },
      { kind: "audiooutput", deviceId: "headphones", label: "Headphones" },
      { kind: "audiooutput", deviceId: "headphones", label: "Headphones again" },
      { kind: "audiooutput", deviceId: "monitor", label: "  " },
    ]);
    expect(choices.map((choice) => choice.deviceId)).toEqual(["headphones", "monitor"]);
    expect(choices[0]).toMatchObject({ label: "Headphones", unlabeled: false });
    expect(choices[1]).toMatchObject({ label: "Audio output 1", unlabeled: true });
    expect(outputDeviceList(choices.map((choice) => ({ kind: "audiooutput", ...choice }))).labelsHidden).toBe(false);
    const hidden = outputDeviceList([{ kind: "audiooutput", deviceId: "monitor", label: "" }]);
    expect(hidden.labelsHidden).toBe(true);
    expect(hidden.ok).toBe(true);
    expect(outputDeviceList(null)).toEqual({ ok: false, choices: [], labelsHidden: false });
  });

  it("keeps a safe device id and falls back to the default when that device is unplugged", () => {
    expect(sanitizeOutputDeviceId("  headphones  ")).toBe("headphones");
    expect(sanitizeOutputDeviceId("")).toBe("");
    expect(sanitizeOutputDeviceId("bad\nid")).toBe("");
    const list = outputDeviceList([
      { kind: "audiooutput", deviceId: "headphones", label: "Headphones" },
    ]);
    expect(resolveOutputDeviceId("headphones", list)).toBe("headphones");
    expect(resolveOutputDeviceId("unplugged", list)).toBe("");
    expect(resolveOutputDeviceId("  ", list)).toBe("");
    expect(resolveOutputDeviceId("headphones", outputDeviceList(null))).toBe("headphones");
  });

  it("routes the chime through the Web Audio context when that sink can be chosen", () => {
    expect(chooseSinkRoute({ audioContext: true, audioElement: true })).toBe("audio-context");
    expect(chooseSinkRoute({ audioContext: false, audioElement: true })).toBe("audio-element");
    expect(chooseSinkRoute({ audioContext: false, audioElement: false })).toBe("default");
  });
});
