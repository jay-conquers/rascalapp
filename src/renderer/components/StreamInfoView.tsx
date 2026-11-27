import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { KICK_TITLE_MAX, TWITCH_TITLE_MAX, YOUTUBE_TITLE_MAX } from "../../shared/defaults";
import { kickTitleBlock } from "../../shared/kick/channel";
import { youtubeTitleBlock } from "../../shared/platform/youtube-broadcast";
import { streamInfoPlatforms } from "../../shared/stream-platforms";
import type { PlatformStreamDraft, PlatformStreamResult, StreamEditRequest, StreamEditResult } from "../../shared/stream-edit";
import type { AuthState, CategoryHit, Platform, StreamInfo } from "../../shared/types";
import { YoutubeStudioButton } from "./YoutubeStudioButton";

export interface YoutubeStreamContext {
  loggedIn: boolean;
  scopes: readonly string[];
  title: string;
  videoId?: string;
  channelId?: string;
}

export interface KickStreamContext {
  loggedIn: boolean;
  scopes: readonly string[];
  title: string;
  categoryId: string;
  categoryName: string;
}

const EMPTY_YOUTUBE: YoutubeStreamContext = { loggedIn: false, scopes: [], title: "" };
const EMPTY_KICK: KickStreamContext = { loggedIn: false, scopes: [], title: "", categoryId: "", categoryName: "" };

export function StreamInfoView({
  auth,
  stream,
  chatChannel,
  enabledIds,
  youtube,
  kick,
  onSave,
  onSearch,
  onLogin,
  onOpenSettings,
  onOpenExternal,
  onYoutubeLogin,
  onKickLogin,
}: {
  auth: AuthState;
  stream: StreamInfo | null;
  chatChannel: string;
  enabledIds?: readonly string[];
  youtube?: YoutubeStreamContext;
  kick?: KickStreamContext;
  onSave: (request: StreamEditRequest) => Promise<StreamEditResult>;
  onSearch: (query: string, platform?: "twitch" | "kick") => Promise<CategoryHit[]>;
  onLogin: () => void;
  onOpenSettings: () => void;
  onOpenExternal?: (url: string) => void;
  onYoutubeLogin?: () => void;
  onKickLogin?: () => void;
}) {
  const youtubeInfo = youtube ?? EMPTY_YOUTUBE;
  const kickInfo = kick ?? EMPTY_KICK;
  const sections = streamInfoPlatforms.filter((platform) => !enabledIds || enabledIds.includes(platform.id));
  const ids = sections.map((section) => section.id);
  const [applyAll, setApplyAll] = useState(false);
  const [sharedTitle, setSharedTitle] = useState("");
  const [savingAll, setSavingAll] = useState(false);
  const [sharedError, setSharedError] = useState<string | null>(null);
  const [results, setResults] = useState<PlatformStreamResult[]>([]);
  const drafts = useRef(new Map<Platform, PlatformStreamDraft>());
  const remember = useCallback((draft: PlatformStreamDraft) => {
    drafts.current.set(draft.platform, draft);
  }, []);
  const limit = sharedLimit(ids);

  async function save(request: StreamEditRequest): Promise<void> {
    const result = await onSave(request);
    setResults(result.results);
  }

  return (
    <section className="stream-page" data-testid="stream-info">
      <div className="stream-page-inner">
        <header className="panel-head">
          <div>
            <h2>Stream info</h2>
            <p className="form-note">Title, and category where the platform has one.</p>
          </div>
        </header>
        {ids.length > 1 ? (
          <form
            className="stream-form"
            onSubmit={(event) => {
              event.preventDefault();
              setSavingAll(true);
              setSharedError(null);
              const edits = ids.map((id) => drafts.current.get(id) ?? { platform: id, title: sharedTitle });
              void save({ applyAll: true, title: sharedTitle, edits })
                .catch((err: unknown) => setSharedError(err instanceof Error ? err.message : "Could not update the stream."))
                .finally(() => setSavingAll(false));
            }}
          >
            <label className="check-row">
              <input
                type="checkbox"
                data-testid="apply-all"
                checked={applyAll}
                onChange={(event) => setApplyAll(event.target.checked)}
              />
              Apply this title to all enabled platforms
            </label>
            {applyAll ? (
              <label>
                Title
                <textarea
                  data-testid="shared-title"
                  value={sharedTitle}
                  maxLength={limit}
                  rows={3}
                  onChange={(event) => setSharedTitle(event.target.value)}
                />
                <span className="count">{sharedTitle.trim().length}/{limit}</span>
              </label>
            ) : null}
            {sharedError ? <p className="form-error">{sharedError}</p> : null}
            {applyAll ? (
              <div className="form-actions">
                <button type="submit" className="primary" disabled={savingAll || !sharedTitle.trim()}>
                  {savingAll ? "Saving" : "Update all"}
                </button>
              </div>
            ) : null}
          </form>
        ) : null}
        {sections.map((section) => (
          <PlatformSection
            key={section.id}
            id={section.id}
            title={section.title}
            accessory={
              section.id === "youtube" ? (
                <YoutubeStudioButton
                  enabled
                  broadcastId={youtubeInfo.videoId}
                  channelId={youtubeInfo.channelId}
                  onOpen={(url) => onOpenExternal?.(url)}
                />
              ) : null
            }
          >
            <PlatformStreamCard
              platform={section.id}
              auth={auth}
              stream={stream}
              chatChannel={chatChannel}
              youtube={youtubeInfo}
              kick={kickInfo}
              result={results.find((row) => row.platform === section.id) ?? null}
              onRemember={remember}
              onSave={save}
              onSearch={onSearch}
              onLogin={onLogin}
              onOpenSettings={onOpenSettings}
              onYoutubeLogin={onYoutubeLogin}
              onKickLogin={onKickLogin}
            />
          </PlatformSection>
        ))}
        {sections.length === 0 ? (
          <p className="form-note">Turn a platform on in Settings to edit its title and category.</p>
        ) : null}
      </div>
    </section>
  );
}

function PlatformSection({
  id,
  title,
  accessory,
  children,
}: {
  id: string;
  title: string;
  accessory?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="platform-section" data-platform={id} aria-label={title}>
      <div className="panel-head">
        <h3>{title}</h3>
        {accessory}
      </div>
      {children}
    </section>
  );
}

function PlatformStreamCard({
  platform,
  auth,
  stream,
  chatChannel,
  youtube,
  kick,
  result,
  onRemember,
  onSave,
  onSearch,
  onLogin,
  onOpenSettings,
  onYoutubeLogin,
  onKickLogin,
}: {
  platform: Platform;
  auth: AuthState;
  stream: StreamInfo | null;
  chatChannel: string;
  youtube: YoutubeStreamContext;
  kick: KickStreamContext;
  result: PlatformStreamResult | null;
  onRemember: (draft: PlatformStreamDraft) => void;
  onSave: (request: StreamEditRequest) => Promise<void>;
  onSearch: (query: string, platform?: "twitch" | "kick") => Promise<CategoryHit[]>;
  onLogin: () => void;
  onOpenSettings: () => void;
  onYoutubeLogin?: () => void;
  onKickLogin?: () => void;
}) {
  const source = sourceFor(platform, stream, youtube, kick);
  const sourceKey = `${source.title}\n${source.gameId}\n${source.gameName}\n${source.tags.join("\n")}`;
  const [title, setTitle] = useState(source.title);
  const [gameId, setGameId] = useState(source.gameId);
  const [gameName, setGameName] = useState(source.gameName);
  const [tags, setTags] = useState<string[]>(source.tags);
  const [tagDraft, setTagDraft] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CategoryHit[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const block = blockFor(platform, auth, youtube, kick);
  const loggedIn = platform === "twitch" ? auth.loggedIn : platform === "youtube" ? youtube.loggedIn : kick.loggedIn;
  const max = platform === "youtube" ? YOUTUBE_TITLE_MAX : platform === "kick" ? KICK_TITLE_MAX : TWITCH_TITLE_MAX;

  useEffect(() => {
    if (dirtyRef.current) return;
    setTitle(source.title);
    setGameId(source.gameId);
    setGameName(source.gameName);
    setTags(source.tags);
    // sourceKey is the snapshot of those fields. The effect runs on that render.
  }, [sourceKey]);

  useEffect(() => {
    onRemember({
      platform,
      title,
      gameId: platform === "youtube" ? undefined : gameId,
      tags: platform === "twitch" ? tags : undefined,
    });
  }, [platform, title, gameId, tags, onRemember]);

  useEffect(() => {
    if (platform === "youtube" || !loggedIn || query.trim().length < (platform === "kick" ? 3 : 2)) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void onSearch(query, platform)
        .then((next) => {
          if (!cancelled) {
            setHits(next);
            setSearchError(null);
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) setSearchError(err instanceof Error ? err.message : "Category search failed.");
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, loggedIn, onSearch, platform]);

  function markDirty(): void {
    dirtyRef.current = true;
  }

  async function saveThis(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        applyAll: false,
        title,
        edits: [{ platform, title, gameId: platform === "youtube" ? undefined : gameId, tags: platform === "twitch" ? tags : undefined }],
      });
      dirtyRef.current = false;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the stream.");
    } finally {
      setSaving(false);
    }
  }

  if (platform === "twitch" && !auth.loggedIn) {
    return (
      <div data-testid="stream-panel">
        <div className="panel-lock">
          <p>Title, category, and tags need a Twitch login. Reading chat does not.</p>
          {auth.clientIdSet ? (
            <button type="button" className="primary" onClick={onLogin}>Log in with Twitch</button>
          ) : (
            <button type="button" className="primary" onClick={onOpenSettings}>Add client ID</button>
          )}
        </div>
      </div>
    );
  }

  if ((platform === "youtube" || platform === "kick") && !loggedIn) {
    return (
      <div>
        {platform === "youtube" ? <YoutubeNotes /> : <KickNote />}
        <div className="panel-lock">
          <p>{block}</p>
          <button type="button" className="primary" onClick={platform === "youtube" ? onYoutubeLogin : onKickLogin}>
            {platform === "youtube" ? "Connect YouTube" : "Log in with Kick"}
          </button>
        </div>
      </div>
    );
  }

  const mismatch = platform === "twitch" && auth.loggedIn && auth.login && auth.login.toLowerCase() !== chatChannel;
  const needsGame = platform === "twitch";

  return (
    <form
      className="stream-form"
      data-testid={platform === "twitch" ? "stream-panel" : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        void saveThis();
      }}
    >
      {platform === "twitch" && stream ? (
        <span className={stream.live ? "live-pill on" : "live-pill"}>
          {stream.live ? `Live${stream.viewerCount !== null ? ` · ${stream.viewerCount}` : ""}` : "Offline"}
        </span>
      ) : null}
      {platform === "youtube" ? <YoutubeNotes /> : null}
      {platform === "kick" ? <KickNote /> : null}
      {block ? (
        <div className="panel-lock">
          <p className="form-error" data-testid={`${platform}-scope`}>{block}</p>
          <button
            type="button"
            onClick={() => {
              if (platform === "youtube") onYoutubeLogin?.();
              else if (platform === "kick") onKickLogin?.();
              else onLogin();
            }}
          >
            Log in again
          </button>
        </div>
      ) : null}
      {mismatch ? (
        <p className="form-note">Chat is #{chatChannel}. This form updates the logged-in channel ({auth.login}).</p>
      ) : null}
      <label>
        Title
        <textarea
          data-testid={platform === "twitch" ? "stream-title" : `${platform}-title`}
          value={title}
          maxLength={max}
          rows={3}
          onChange={(event) => {
            setTitle(event.target.value);
            markDirty();
          }}
        />
        <span className="count">{title.trim().length}/{max}</span>
      </label>
      {platform !== "youtube" ? (
        <>
          <label>
            Category
            <input
              data-testid={platform === "twitch" ? "category-search" : "kick-category"}
              value={query}
              placeholder={gameName || "Search games"}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
            />
          </label>
          {gameName ? <p className="picked">Selected: {gameName}</p> : null}
          {searchError ? <p className="form-error">{searchError}</p> : null}
          {hits.length > 0 ? (
            <ul className="hits">
              {hits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setGameId(hit.id);
                      setGameName(hit.name);
                      setQuery("");
                      setHits([]);
                      markDirty();
                    }}
                  >
                    {hit.boxArtUrl ? <img src={hit.boxArtUrl} alt="" /> : null}
                    <span>{hit.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      {platform === "twitch" ? (
        <TagField
          tags={tags}
          draft={tagDraft}
          onDraft={setTagDraft}
          onAdd={(tag) => {
            setTags((current) => [...current, tag].slice(0, 10));
            setTagDraft("");
            markDirty();
          }}
          onRemove={(tag) => {
            setTags((current) => current.filter((item) => item !== tag));
            markDirty();
          }}
          onTrim={() => {
            setTags((current) => current.slice(0, -1));
            markDirty();
          }}
        />
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
      {result ? (
        <p className={result.ok ? "form-note" : "form-error"} data-testid={`stream-result-${platform}`}>{result.message}</p>
      ) : null}
      <div className="form-actions">
        <button type="submit" className="primary" disabled={saving || Boolean(block) || !title.trim() || (needsGame && !gameId)}>
          {saving ? "Saving" : "Update stream"}
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            dirtyRef.current = false;
            setTitle(source.title);
            setGameId(source.gameId);
            setGameName(source.gameName);
            setTags(source.tags);
            setError(null);
          }}
        >
          Revert
        </button>
      </div>
    </form>
  );
}

function YoutubeNotes() {
  return (
    <p className="form-note" data-testid="youtube-game-note">
      YouTube has no game field for a live stream. Set the game in YouTube Studio. Saving the title costs 50 quota units.
    </p>
  );
}

function KickNote() {
  return <p className="form-note">Kick saves the title and category through its API. A relay is not required.</p>;
}

function TagField({
  tags,
  draft,
  onDraft,
  onAdd,
  onRemove,
  onTrim,
}: {
  tags: string[];
  draft: string;
  onDraft: (value: string) => void;
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  onTrim: () => void;
}) {
  function addTag(raw: string): void {
    const tag = raw.trim();
    if (!tag) return;
    if (tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
      onDraft("");
      return;
    }
    onAdd(tag);
  }
  return (
    <div className="tag-field">
      <label htmlFor="tag-input">Tags</label>
      <div className="chips">
        {tags.map((tag) => (
          <button key={tag} type="button" className="chip" onClick={() => onRemove(tag)}>
            {tag}
            <span aria-hidden="true">×</span>
          </button>
        ))}
      </div>
      <input
        id="tag-input"
        value={draft}
        placeholder="Add a tag, then Enter"
        onChange={(event) => onDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            addTag(draft);
          } else if (event.key === "Backspace" && !draft && tags.length > 0) {
            onTrim();
          }
        }}
      />
      <span className="count">{tags.length}/10 · letters and numbers only</span>
    </div>
  );
}

function sourceFor(platform: Platform, stream: StreamInfo | null, youtube: YoutubeStreamContext, kick: KickStreamContext): {
  title: string;
  gameId: string;
  gameName: string;
  tags: string[];
} {
  if (platform === "twitch") {
    return { title: stream?.title ?? "", gameId: stream?.gameId ?? "", gameName: stream?.gameName ?? "", tags: stream?.tags ?? [] };
  }
  if (platform === "youtube") return { title: youtube.title, gameId: "", gameName: "", tags: [] };
  return { title: kick.title, gameId: kick.categoryId, gameName: kick.categoryName, tags: [] };
}

function blockFor(platform: Platform, auth: AuthState, youtube: YoutubeStreamContext, kick: KickStreamContext): string | null {
  if (platform === "youtube") return youtubeTitleBlock({ loggedIn: youtube.loggedIn, scopes: youtube.scopes });
  if (platform === "kick") return kickTitleBlock({ loggedIn: kick.loggedIn, scopes: kick.scopes });
  if (!auth.loggedIn) return "Title, category, and tags need a Twitch login. Reading chat does not.";
  if (auth.missingScopes.includes("channel:manage:broadcast")) {
    return "Re-login needed. This Twitch login is missing channel:manage:broadcast. Log in again to edit the title and category.";
  }
  return null;
}

function sharedLimit(ids: readonly string[]): number {
  let max = KICK_TITLE_MAX;
  if (ids.includes("twitch")) max = Math.min(max, TWITCH_TITLE_MAX);
  if (ids.includes("youtube")) max = Math.min(max, YOUTUBE_TITLE_MAX);
  return max;
}
