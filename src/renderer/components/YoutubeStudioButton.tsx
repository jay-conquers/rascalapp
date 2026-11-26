import { youtubeStudioUrl } from "../../shared/platform/youtube-studio";

/** Opens YouTube Studio in the system browser. Hidden while YouTube is turned off. */
export function YoutubeStudioButton({
  enabled,
  broadcastId,
  channelId,
  onOpen,
}: {
  enabled: boolean;
  broadcastId?: string | null;
  channelId?: string | null;
  onOpen: (url: string) => void;
}) {
  if (!enabled) return null;
  const url = youtubeStudioUrl({ broadcastId, channelId });
  return (
    <button
      type="button"
      className="text-button studio-link"
      data-testid="youtube-studio"
      data-studio-url={url}
      onClick={() => onOpen(url)}
    >
      YouTube Studio
    </button>
  );
}
