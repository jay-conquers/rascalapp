/** Google login progress for the chat box. The desk owns the session; this is only the shape. */
export interface YoutubeDeskState {
  connected: boolean;
  account: string | null;
  channelId: string | null;
  status: string;
  login: { verificationUri: string; expiresAt: number } | null;
  /** Which connect button is waiting on the Google redirect. */
  purpose: "desk" | "bot" | null;
}
