import { YOUTUBE_OAUTH_SCOPE } from "./youtube-oauth.ts";

export interface YoutubeSendStatus {
  canSend: boolean;
  hint: string;
}

/**
 * The chat box can post only after a Google client exists and an account has
 * accepted youtube.force-ssl. Reading chat through the page does not need either.
 */
export function youtubeSendStatus(input: { clientId: string; account: string | null; scopes: readonly string[] }): YoutubeSendStatus {
  const scopeOk = input.scopes.length === 0 || input.scopes.some((scope) => scope === YOUTUBE_OAUTH_SCOPE || scope.includes("youtube.force-ssl"));
  if (!input.account) {
    if (!input.clientId.trim()) {
      return {
        canSend: false,
        hint: "YouTube sending isn't set up, so this box stays off. Reading chat still works without Google: put the channel ID in Settings. To send, open the Bot tab, save a Google OAuth client, and connect an account. That login asks for youtube.force-ssl.",
      };
    }
    return {
      canSend: false,
      hint: "YouTube sending isn't authorized, so this box stays off. Open the Bot tab and connect the account that should post. The login asks for youtube.force-ssl. Reading chat does not need it. The channel ID for reading is in Settings.",
    };
  }
  if (!scopeOk) {
    return {
      canSend: false,
      hint: "This YouTube login is missing youtube.force-ssl, so sending stays off. Open the Bot tab and connect again. Reading chat keeps working without that permission. The channel ID is in Settings.",
    };
  }
  return { canSend: true, hint: "" };
}
