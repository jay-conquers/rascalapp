import { useEffect, useState } from "react";
import { resolveOutputDeviceId, sanitizeOutputDeviceId, type OutputDeviceList } from "../../shared/audio-output";
import { listOutputDevices, outputRoutingSupported } from "../output-devices";

const HELP =
  "Pick headphones or a monitor output that OBS does not capture, or exclude Rascal from OBS Desktop Audio, so only you hear the message beep. This does not move TTS or redeem alerts.";

export function AlertOutputPicker({
  deviceId,
  onDeviceId,
  onTest,
}: {
  deviceId: string;
  onDeviceId: (deviceId: string) => void;
  onTest: (deviceId: string) => void;
}) {
  const [list, setList] = useState<OutputDeviceList | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    let stopped = false;
    const refresh = (): void => {
      setSupported(outputRoutingSupported());
      void listOutputDevices().then((next) => {
        if (!stopped) setList(next);
      });
    };
    refresh();
    const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (!media?.addEventListener) return () => { stopped = true; };
    media.addEventListener("devicechange", refresh);
    return () => {
      stopped = true;
      media.removeEventListener("devicechange", refresh);
    };
  }, []);

  const knownSupport = supported !== null ? supported : typeof window === "undefined" ? null : outputRoutingSupported();
  const canRoute = knownSupport !== false;
  const effective = list ? resolveOutputDeviceId(deviceId, list) : sanitizeOutputDeviceId(deviceId);
  const shown = canRoute ? effective : "";
  const orphan = canRoute && Boolean(shown) && !list?.choices.some((choice) => choice.deviceId === shown);
  const missing = Boolean(canRoute && list?.ok && sanitizeOutputDeviceId(deviceId) && !effective);

  return (
    <div className="output-device" data-testid="alert-output">
      <label htmlFor="settings-alert-output">Output device</label>
      <div className="output-device-row">
        <select
          id="settings-alert-output"
          data-setting="chatAlert.outputDeviceId"
          data-testid="alert-output-device"
          value={shown}
          disabled={!canRoute}
          onChange={(event) => onDeviceId(sanitizeOutputDeviceId(event.target.value))}
        >
          <option value="">System default</option>
          {(canRoute ? list?.choices ?? [] : []).map((choice) => (
            <option key={choice.deviceId} value={choice.deviceId}>
              {choice.label}
            </option>
          ))}
          {orphan ? <option value={shown}>Saved output</option> : null}
        </select>
        <button type="button" className="ghost" onClick={() => {
          setSupported(outputRoutingSupported());
          void listOutputDevices().then(setList);
        }}>
          Refresh devices
        </button>
        <button type="button" className="ghost" data-testid="alert-test-sound" onClick={() => onTest(shown)}>
          Test sound
        </button>
      </div>
      <p className="count" data-testid="alert-output-help">{HELP}</p>
      {!canRoute ? (
        <p className="count" data-testid="alert-output-unsupported">
          This system plays the chime on the default output. Choosing another device is not available here.
        </p>
      ) : null}
      {missing ? (
        <p className="count" data-testid="alert-output-fallback">
          The saved output is not connected, so the chime uses the system default.
        </p>
      ) : null}
      {list && !list.ok ? (
        <p className="count">Output devices could not be listed. The chime uses the saved device when it is still connected.</p>
      ) : null}
      {list?.labelsHidden ? (
        <p className="count">Device names are hidden. These are still the outputs this computer reported.</p>
      ) : null}
    </div>
  );
}
