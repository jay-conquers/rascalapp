import { useEffect, useState } from "react";
import { brand } from "../../shared/brand";
import { CheckRow } from "./CheckRow";
import {
  DEFAULT_VIDEO_PLACEMENT,
  PLACEMENT_PRESETS,
  placementBox,
  type PlacementPreset,
  type RedeemMapping,
  type RedeemSnapshot,
  type RewardRow,
  type VideoPlacement,
} from "../../shared/redeems";

export function RedeemsView({
  state,
  onLogin,
}: {
  state: RedeemSnapshot;
  onLogin: () => void;
}) {
  const [selected, setSelected] = useState(state.rewards[0]?.id ?? "");
  const reward = state.rewards.find((item) => item.id === selected) ?? state.rewards[0] ?? null;

  useEffect(() => {
    if (!state.rewards.some((item) => item.id === selected)) setSelected(state.rewards[0]?.id ?? "");
  }, [state.rewards, selected]);

  return (
    <section className="redeems" data-testid="redeems">
      <header className="redeem-bar">
        <div>
          <h2>Channel points</h2>
          <p>{state.status}</p>
          <p className="count">
            OBS browser source: <code>{state.overlayUrl || "http://127.0.0.1:4777/overlay/alerts"}</code>
          </p>
        </div>
        <div className="form-actions">
          <button type="button" className="ghost" onClick={() => void run(() => window.rascal!.refreshRedeems())}>
            Refresh
          </button>
          <button type="button" className="ghost" onClick={() => void run(() => window.rascal!.importFirebot())}>
            Import from Firebot
          </button>
          <button type="button" className="ghost" onClick={() => void run(() => window.rascal!.skipAlert())}>
            Skip current
          </button>
          <button type="button" className="ghost" onClick={() => void run(() => window.rascal!.clearAlerts())}>
            Clear queue
          </button>
        </div>
      </header>
      {state.staleOverlay && (
        <div className="banner">
          <p>An overlay is still on an older build. It should reload itself. If the video still fills the screen, refresh the OBS browser source.</p>
        </div>
      )}
      {state.overlayCount === 0 && (
        <div className="banner" data-testid="overlay-banner">
          <p>No overlay connected - add the OBS browser source ({state.overlayUrl})</p>
        </div>
      )}
      {state.scopeMissing && (
        <div className="banner">
          <p>This Twitch login is missing channel point access. Log in again to grant it.</p>
          <button type="button" onClick={onLogin}>
            Log in again
          </button>
        </div>
      )}
      <p className="queue-line">
        {state.overlayCount === 0
          ? "No overlay connected"
          : `${state.overlayCount} overlay${state.overlayCount === 1 ? "" : "s"} connected · ${state.overlayVersion} ${state.overlayHash}`}
        {" · "}
        {state.queue.current
          ? `Playing ${state.queue.current.title} for ${state.queue.current.userName}`
          : "Nothing playing"}
        {state.queue.pending.length > 0 ? ` · ${state.queue.pending.length} waiting` : ""}
      </p>
      <div className="redeem-grid">
        <div className="reward-column">
          <CreateReward canManage={state.canManage} />
          <ul className="reward-list">
            {state.rewards.length === 0 && <li className="count">No rewards loaded yet.</li>}
            {state.rewards.map((item) => (
              <li key={item.id || item.title}>
                <button
                  type="button"
                  className={reward?.id === item.id ? "reward on" : "reward"}
                  onClick={() => setSelected(item.id)}
                >
                  <strong>{item.title}</strong>
                  <span>
                    {item.cost > 0 ? `${item.cost} pts` : "Not on Twitch yet"}
                    {item.manageable ? ` · ${brand.displayName}` : ""}
                    {item.mapping.action !== "none" ? ` · ${item.mapping.action}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        {reward ? (
          <RewardEditor
            key={reward.id || reward.title}
            reward={reward}
            canManage={state.canManage}
            soundFolder={state.soundFolder}
            overlayCount={state.overlayCount}
            overlayUrl={state.overlayUrl}
          />
        ) : (
          <p className="count">Rewards show up here after you log in, or after a Firebot import.</p>
        )}
      </div>
    </section>
  );
}

function RewardEditor({
  reward,
  canManage,
  soundFolder,
  overlayCount,
  overlayUrl,
}: {
  reward: RewardRow;
  canManage: boolean;
  soundFolder: string;
  overlayCount: number;
  overlayUrl: string;
}) {
  const [mapping, setMapping] = useState<RedeemMapping>(reward.mapping);
  const [title, setTitle] = useState(reward.title);
  const [cost, setCost] = useState(String(reward.cost || ""));
  const [twitchEnabled, setTwitchEnabled] = useState(reward.enabledOnTwitch);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMapping(reward.mapping);
    setTitle(reward.title);
    setCost(String(reward.cost || ""));
    setTwitchEnabled(reward.enabledOnTwitch);
  }, [reward]);

  const seconds = mapping.maxDurationMs ? String(Math.round(mapping.maxDurationMs / 1000)) : "";

  return (
    <form
      className="reward-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void run(() => window.rascal!.saveRedeem(mapping));
      }}
    >
      <h3>{reward.title}</h3>
      {error && <p className="form-error">{error}</p>}
      <label>
        Action
        <select
          value={mapping.action}
          onChange={(event) => setMapping({ ...mapping, action: event.target.value as RedeemMapping["action"] })}
        >
          <option value="none">None</option>
          <option value="video">Play video</option>
          <option value="sound">Play sound</option>
        </select>
      </label>
      <label>
        File
        <span className="file-row">
          <input
            value={mapping.filePath}
            placeholder={mapping.action === "sound" ? soundFolder : "Choose a file"}
            onChange={(event) => setMapping({ ...mapping, filePath: event.target.value })}
          />
          <button
            type="button"
            className="ghost"
            onClick={() => {
              void window.rascal
                ?.pickMediaFile(mapping.action === "sound" ? "sound" : "video")
                .then((file) => {
                  if (file) setMapping((current) => ({ ...current, filePath: file }));
                })
                .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not open a file."));
            }}
          >
            Browse
          </button>
        </span>
      </label>
      {mapping.action === "video" && (
        <PlacementControls
          placement={mapping.placement ?? DEFAULT_VIDEO_PLACEMENT}
          onChange={(placement) => setMapping({ ...mapping, placement })}
        />
      )}
      <label>
        Volume {mapping.volume}
        <input
          type="range"
          min={0}
          max={100}
          value={mapping.volume}
          onChange={(event) => setMapping({ ...mapping, volume: Number(event.target.value) })}
        />
      </label>
      <label>
        Max seconds
        <input
          value={seconds}
          inputMode="numeric"
          placeholder="Play the whole file"
          onChange={(event) => {
            const digits = event.target.value.replace(/[^\d]/g, "");
            setMapping({
              ...mapping,
              maxDurationMs: digits ? Number(digits) * 1000 : null,
            });
          }}
        />
      </label>
      <CheckRow checked={mapping.enabled} onChange={(enabled) => setMapping({ ...mapping, enabled })}>
        Enabled
      </CheckRow>
      <div className="form-actions">
        <button className="primary" type="submit">
          Save mapping
        </button>
        <button
          className="ghost"
          type="button"
          onClick={() => {
            if (overlayCount === 0) {
              window.alert(
                `No overlay connected - add the OBS browser source (${overlayUrl}). The test stays queued and plays when OBS connects.`,
              );
            }
            void run(() => window.rascal!.testRedeem(reward.id, mapping));
          }}
        >
          Test
        </button>
      </div>
      {reward.manageable && (
        <div className="twitch-edit">
          <h3>Twitch reward</h3>
          <p className="count">{brand.displayName} created this reward, so it can edit the title, cost, and enabled flag.</p>
          <label>
            Title
            <input value={title} maxLength={45} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            Cost
            <input value={cost} inputMode="numeric" onChange={(event) => setCost(event.target.value.replace(/[^\d]/g, ""))} />
          </label>
          <CheckRow checked={twitchEnabled} onChange={setTwitchEnabled}>
            Enabled on Twitch
          </CheckRow>
          <button
            type="button"
            className="primary"
            disabled={!canManage}
            onClick={() =>
              void run(() =>
                window.rascal!.updateReward(reward.id, { title, cost: Number(cost), enabled: twitchEnabled }),
              )
            }
          >
            Update on Twitch
          </button>
        </div>
      )}
      {!reward.manageable && reward.id && (
        <p className="count">Another app created this reward. {brand.displayName} can play it, and will not change it on Twitch.</p>
      )}
    </form>
  );
}

const PRESET_LABELS: Record<PlacementPreset, string> = {
  center: "Center",
  "top-left": "Top-left",
  top: "Top",
  "top-right": "Top-right",
  left: "Left",
  right: "Right",
  "bottom-left": "Bottom-left",
  bottom: "Bottom",
  "bottom-right": "Bottom-right",
  custom: "Custom",
};

function PlacementControls({
  placement,
  onChange,
}: {
  placement: VideoPlacement;
  onChange: (placement: VideoPlacement) => void;
}) {
  const box = placementBox(placement);
  return (
    <div className="placement">
      <label>
        Position
        <select
          value={placement.preset}
          onChange={(event) => onChange({ ...placement, preset: event.target.value as PlacementPreset })}
        >
          {PLACEMENT_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {PRESET_LABELS[preset]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Size {placement.sizePercent}% of overlay width
        <input
          type="range"
          min={10}
          max={100}
          value={placement.sizePercent}
          onChange={(event) => onChange({ ...placement, sizePercent: Number(event.target.value) })}
        />
      </label>
      {placement.preset !== "custom" && placement.preset !== "center" && (
        <label>
          Edge margin {placement.marginPercent}%
          <input
            type="range"
            min={0}
            max={20}
            step={0.5}
            value={placement.marginPercent}
            onChange={(event) => onChange({ ...placement, marginPercent: Number(event.target.value) })}
          />
        </label>
      )}
      {placement.preset === "custom" && (
        <div className="custom-offset">
          <label>
            X
            <input
              value={String(placement.customX)}
              onChange={(event) => onChange({ ...placement, customX: Number(event.target.value) || 0 })}
            />
          </label>
          <label>
            Y
            <input
              value={String(placement.customY)}
              onChange={(event) => onChange({ ...placement, customY: Number(event.target.value) || 0 })}
            />
          </label>
          <label>
            Units
            <select
              value={placement.customUnit}
              onChange={(event) =>
                onChange({ ...placement, customUnit: event.target.value === "px" ? "px" : "percent" })
              }
            >
              <option value="percent">Percent</option>
              <option value="px">Pixels</option>
            </select>
          </label>
        </div>
      )}
      <div className="placement-preview" aria-hidden="true">
        <div
          className="placement-video"
          style={{
            left: `${(box.left / 1920) * 100}%`,
            top: `${(box.top / 1080) * 100}%`,
            width: `${(box.width / 1920) * 100}%`,
            height: `${(box.height / 1080) * 100}%`,
          }}
        />
      </div>
      <p className="count">Preview uses a 16:9 stand-in. The overlay keeps the file's real aspect.</p>
    </div>
  );
}

function CreateReward({ canManage }: { canManage: boolean }) {
  const [title, setTitle] = useState("");
  const [cost, setCost] = useState("100");
  if (!canManage) return null;
  return (
    <form
      className="create-reward"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await window.rascal!.createReward(title, Number(cost));
          setTitle("");
        });
      }}
    >
      <h3>New {brand.displayName} reward</h3>
      <div className="create-reward-fields">
        <label>
          Reward name
          <input value={title} placeholder="Reward name" maxLength={45} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          Cost
          <input
            value={cost}
            inputMode="numeric"
            aria-label="Point cost"
            onChange={(event) => setCost(event.target.value.replace(/[^\d]/g, ""))}
          />
        </label>
      </div>
      <button className="primary" type="submit">
        Create
      </button>
    </form>
  );
}

async function run(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (err) {
    const message = err instanceof Error ? err.message : "That did not work.";
    window.alert(message);
  }
}
