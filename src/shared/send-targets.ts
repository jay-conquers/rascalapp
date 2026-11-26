/** Which chats a typed message should go to. Independent of live or offline. */
export interface SendTargets {
  twitch: boolean;
  youtube: boolean;
  /** Absent on older files. Those installs do not send to Kick until the box is checked. */
  kick?: boolean;
}

export interface PlatformLink {
  /** A message can be delivered right now. */
  ready: boolean;
  /** Chat is down or there is no live chat. This must not clear a saved check. */
  offline: boolean;
}

export interface SendPlan {
  /** The saved checks, unchanged by live or offline. */
  saved: SendTargets;
  /** Where this message should actually go. */
  deliver: SendTargets;
  /** Checked platforms that are offline and will be skipped. */
  offline: { twitch: boolean; youtube: boolean; kick: boolean };
}

/** A new install sends to Twitch only. */
export function defaultSendTargets(): SendTargets {
  return { twitch: true, youtube: false, kick: false };
}

export function mergeSendTargets(current: SendTargets | undefined, patch: unknown): SendTargets {
  const base = current ?? defaultSendTargets();
  const row = patch && typeof patch === "object" ? (patch as Record<string, unknown>) : {};
  return {
    twitch: typeof row.twitch === "boolean" ? row.twitch : base.twitch !== false,
    youtube: typeof row.youtube === "boolean" ? row.youtube : base.youtube === true,
    kick: typeof row.kick === "boolean" ? row.kick : base.kick === true,
  };
}

/**
 * Offline and "not set up" change delivery only. The saved checks come back
 * as they were, so a later online state includes that platform with no re-check.
 */
export function planSend(
  saved: SendTargets,
  link: { twitch: PlatformLink; youtube: PlatformLink; kick?: PlatformLink },
  shown?: { twitch?: boolean; youtube?: boolean; kick?: boolean },
): SendPlan {
  const allowTwitch = shown?.twitch !== false;
  const allowYoutube = shown?.youtube !== false;
  const allowKick = shown?.kick === true;
  const kickLink = link.kick ?? { ready: false, offline: false };
  const kept = { twitch: saved.twitch === true, youtube: saved.youtube === true, kick: saved.kick === true };
  return {
    saved: kept,
    deliver: {
      twitch: kept.twitch && link.twitch.ready && allowTwitch,
      youtube: kept.youtube && link.youtube.ready && allowYoutube,
      kick: kept.kick && kickLink.ready && allowKick,
    },
    offline: {
      twitch: allowTwitch && kept.twitch && link.twitch.offline,
      youtube: allowYoutube && kept.youtube && link.youtube.offline,
      kick: allowKick && kept.kick && kickLink.offline,
    },
  };
}

/** Kick chat can be sent while the channel is offline, once the account and the relay are up. */
export function kickLink(status: { state: string }, loggedIn: boolean): PlatformLink {
  const connected = status.state === "connected";
  return {
    ready: loggedIn && connected,
    offline: loggedIn && !connected && status.state !== "connecting" && status.state !== "idle",
  };
}

/** YouTube can take a chat message only while the page reader is on a live chat. */
export function youtubeLink(status: { state: string; canSend?: boolean }): PlatformLink {
  const live = status.state === "live";
  return {
    ready: live && status.canSend === true,
    offline: !live && status.state !== "idle",
  };
}

/** Twitch chat works while the stream is offline. The link is down only when IRC is not connected. */
export function twitchLink(status: { state: string }, loggedIn: boolean): PlatformLink {
  const connected = status.state === "connected";
  return {
    ready: loggedIn && connected,
    offline: loggedIn && !connected && status.state !== "connecting",
  };
}
