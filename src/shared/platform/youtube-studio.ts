/** YouTube video ids are 11 characters. Channel ids are UC plus 22. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

/**
 * Studio page for the live stream the desk already knows.
 * A broadcast id wins. Otherwise the signed-in channel. Otherwise Studio home.
 */
export function youtubeStudioUrl(input: { broadcastId?: string | null; channelId?: string | null }): string {
  const broadcast = input.broadcastId?.trim() ?? "";
  if (VIDEO_ID.test(broadcast)) return `https://studio.youtube.com/video/${broadcast}/livestreaming`;
  const channel = input.channelId?.trim() ?? "";
  if (CHANNEL_ID.test(channel)) return `https://studio.youtube.com/channel/${channel}/livestreaming`;
  return "https://studio.youtube.com/";
}
