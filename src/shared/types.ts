export type Platform = "twitch" | "youtube";

export type BadgeKind =
  | "mod"
  | "vip"
  | "sub"
  | "broadcaster"
  | "prime"
  | "turbo"
  | "bits"
  | "member"
  | "owner"
  | "other";

export interface ChatBadge {
  kind: BadgeKind;
  label: string;
  /** Subscriber months, when Twitch sent them. */
  detail?: string;
  /** Twitch badge set id, such as subscriber, bits, or broadcaster. */
  set?: string;
  /** Twitch badge version id from the IRC badges tag. */
  version?: string;
  /** YouTube badge image, when the chat payload included one. */
  imageUrl?: string;
}

export interface TextSegment {
  type: "text";
  text: string;
}

export interface EmoteSegment {
  type: "emote";
  text: string;
  url: string;
  source: "twitch" | "youtube" | "bttv" | "ffz" | "7tv";
}

export type Segment = TextSegment | EmoteSegment;

export type MessageKind = "chat" | "action" | "system" | "superchat" | "membership";

export interface ChatMessage {
  id: string;
  platform: Platform;
  channel: string;
  username: string;
  displayName: string;
  authorId?: string;
  color: string;
  badges: ChatBadge[];
  segments: Segment[];
  plainText: string;
  timestamp: number;
  kind: MessageKind;
  amount?: string;
  /** Twitch USERNOTICE system-msg, or a YouTube membership header. */
  notice?: string;
  deleted?: boolean;
}

export interface Settings {
  twitchClientId: string;
  twitchChannel: string;
  youtubeChannelId: string;
  overlayPort: number;
  alwaysOnTop: boolean;
  /** Fill empty redeem files from Firebot on startup. Defaults to on. */
  autoImportFirebot: boolean;
  windowBounds?: { x: number; y: number; width: number; height: number };
}

export interface AuthState {
  loggedIn: boolean;
  login: string | null;
  userId: string | null;
  scopes: string[];
  missingScopes: string[];
  clientIdSet: boolean;
}

export interface LoginPrompt {
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  message?: string;
}

export interface ConnectionSide {
  state: "idle" | "connecting" | "connected" | "offline" | "live" | "reconnecting" | "error";
  detail: string;
}

export interface ConnectionStatus {
  twitch: ConnectionSide;
  youtube: ConnectionSide & { videoId?: string; title?: string; canSend?: boolean; sendAccount?: string | null };
  overlay: { listening: boolean; host: string; port: number };
}

export interface CategoryHit {
  id: string;
  name: string;
  boxArtUrl: string;
}

export interface StreamInfo {
  title: string;
  gameId: string;
  gameName: string;
  tags: string[];
  language: string;
  live: boolean;
  viewerCount: number | null;
  startedAt: string | null;
}

export interface StreamUpdate {
  title: string;
  gameId: string;
  tags: string[];
}

/** Omit does not distribute over a union, so this keeps each event's own fields. */
export type WithoutSeq<T> = T extends unknown ? Omit<T, "seq"> : never;

export type AppEvent =
  | { seq: number; type: "chat"; message: ChatMessage }
  | { seq: number; type: "chat-delete"; id: string }
  | { seq: number; type: "chat-clear"; platform: Platform; username?: string }
  | { seq: number; type: "status"; status: ConnectionStatus }
  | { seq: number; type: "auth"; auth: AuthState }
  | { seq: number; type: "login"; login: LoginPrompt | null }
  | { seq: number; type: "stream"; stream: StreamInfo | null }
  | { seq: number; type: "redeems"; redeems: import("./redeems").RedeemSnapshot }
  | { seq: number; type: "toast"; tone: "error" | "ok"; text: string };

export interface AppSnapshot {
  seq: number;
  messages: ChatMessage[];
  status: ConnectionStatus;
  auth: AuthState;
  settings: Settings;
  stream: StreamInfo | null;
  login: LoginPrompt | null;
  redeems: import("./redeems").RedeemSnapshot;
  chatOverlay: import("./chat-overlay").ChatOverlayFile;
  version: string;
}
