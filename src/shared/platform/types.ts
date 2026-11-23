/**
 * Chat platforms plug in here. Twitch and YouTube are implemented.
 * Kick, Rumble, and TikTok can register the same interface later.
 */
export type ChatRole = "everyone" | "sub" | "vip" | "mod" | "broadcaster";

export interface PlatformCapabilities {
  send: boolean;
  deleteMessage: boolean;
  timeout: boolean;
  ban: boolean;
  unban: boolean;
}

export interface NormalizedBadge {
  id: string;
  label: string;
}

export interface NormalizedChatUser {
  id: string;
  login: string;
  displayName: string;
  roles: ChatRole[];
  badges: NormalizedBadge[];
}

export interface NormalizedChatMessage {
  platform: string;
  messageId: string;
  channelId: string;
  text: string;
  publishedAt: number;
  user: NormalizedChatUser;
}

export interface PlatformLiveStatus {
  connected: boolean;
  live: boolean;
  detail: string;
  title?: string;
  liveChatId?: string;
}

export interface ChatPlatform {
  readonly id: string;
  readonly label: string;
  readonly capabilities: PlatformCapabilities;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  liveStatus(): PlatformLiveStatus;
  sendMessage(text: string): Promise<void>;
  deleteMessage(messageId: string): Promise<void>;
  timeoutUser(userId: string, seconds: number, reason: string): Promise<void>;
  banUser(userId: string, reason: string): Promise<void>;
  unbanUser(userId: string): Promise<void>;
  lookupUser(login: string): Promise<string | null>;
  onMessage(listener: (message: NormalizedChatMessage) => void): () => void;
}
