import { chooseSinkRoute, outputDeviceList, type OutputDeviceList } from "../shared/audio-output";

export async function listOutputDevices(): Promise<OutputDeviceList> {
  const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  if (!media?.enumerateDevices) return outputDeviceList(null);
  try {
    const found = await media.enumerateDevices();
    return outputDeviceList(found.map((device) => ({ kind: device.kind, deviceId: device.deviceId, label: device.label })));
  } catch {
    return outputDeviceList(null);
  }
}

export function outputRoutingSupported(): boolean {
  const audioContext = typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype;
  const audioElement = typeof HTMLAudioElement !== "undefined" && "setSinkId" in HTMLAudioElement.prototype;
  return chooseSinkRoute({ audioContext, audioElement }) !== "default";
}
