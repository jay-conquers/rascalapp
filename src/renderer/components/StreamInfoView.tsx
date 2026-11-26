import { useEffect, useState, type ReactNode } from "react";
import { streamInfoPlatforms } from "../../shared/stream-platforms";
import { TWITCH_TITLE_MAX } from "../../shared/defaults";
import type { AuthState, CategoryHit, StreamInfo } from "../../shared/types";

export function StreamInfoView({
  auth,
  stream,
  chatChannel,
  enabledIds,
  onSave,
  onSearch,
  onLogin,
  onOpenSettings,
}: {
  auth: AuthState;
  stream: StreamInfo | null;
  chatChannel: string;
  enabledIds?: readonly string[];
  onSave: (update: { title: string; gameId: string; tags: string[] }) => Promise<void>;
  onSearch: (query: string) => Promise<CategoryHit[]>;
  onLogin: () => void;
  onOpenSettings: () => void;
}) {
  const sections = streamInfoPlatforms.filter((platform) => !enabledIds || enabledIds.includes(platform.id));
  return (
    <section className="stream-page" data-testid="stream-info">
      <div className="stream-page-inner">
        <header className="panel-head">
          <div>
            <h2>Stream info</h2>
            <p className="form-note">Title, category, and tags. Each platform has its own section.</p>
          </div>
        </header>
        {sections.map((platform) => (
          <PlatformSection key={platform.id} id={platform.id} title={platform.title}>
            {platform.id === "twitch" ? (
              <TwitchStreamSection
                auth={auth}
                stream={stream}
                chatChannel={chatChannel}
                onSave={onSave}
                onSearch={onSearch}
                onLogin={onLogin}
                onOpenSettings={onOpenSettings}
              />
            ) : null}
          </PlatformSection>
        ))}
        {sections.length === 0 ? (
          <p className="form-note">Turn a platform on in Settings to edit its title and category.</p>
        ) : null}
      </div>
    </section>
  );
}

function PlatformSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="platform-section" data-platform={id} aria-label={title}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function TwitchStreamSection({
  auth,
  stream,
  chatChannel,
  onSave,
  onSearch,
  onLogin,
  onOpenSettings,
}: {
  auth: AuthState;
  stream: StreamInfo | null;
  chatChannel: string;
  onSave: (update: { title: string; gameId: string; tags: string[] }) => Promise<void>;
  onSearch: (query: string) => Promise<CategoryHit[]>;
  onLogin: () => void;
  onOpenSettings: () => void;
}) {
  const [title, setTitle] = useState(stream?.title ?? "");
  const [gameId, setGameId] = useState(stream?.gameId ?? "");
  const [gameName, setGameName] = useState(stream?.gameName ?? "");
  const [tags, setTags] = useState<string[]>(stream?.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CategoryHit[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (dirty || !stream) return;
    setTitle(stream.title);
    setGameId(stream.gameId);
    setGameName(stream.gameName);
    setTags(stream.tags);
  }, [stream, dirty]);

  useEffect(() => {
    if (!auth.loggedIn || query.trim().length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void onSearch(query)
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
  }, [query, auth.loggedIn, onSearch]);

  function addTag(raw: string): void {
    const tag = raw.trim();
    if (!tag) return;
    if (tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
      setTagDraft("");
      return;
    }
    setTags((current) => [...current, tag].slice(0, 10));
    setTagDraft("");
    setDirty(true);
  }

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await onSave({ title, gameId, tags });
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the stream.");
    } finally {
      setSaving(false);
    }
  }

  const mismatch = auth.loggedIn && auth.login && auth.login.toLowerCase() !== chatChannel;

  return (
    <div data-testid="stream-panel">
      <div className="panel-head">
        <span className={stream?.live ? "live-pill on" : "live-pill"}>
          {stream?.live ? `Live${stream.viewerCount !== null ? ` · ${stream.viewerCount}` : ""}` : "Offline"}
        </span>
      </div>
      {!auth.loggedIn ? (
        <div className="panel-lock">
          <p>Title, category, and tags need a Twitch login. Reading chat does not.</p>
          {auth.clientIdSet ? (
            <button type="button" className="primary" onClick={onLogin}>
              Log in with Twitch
            </button>
          ) : (
            <button type="button" className="primary" onClick={onOpenSettings}>
              Add client ID
            </button>
          )}
        </div>
      ) : (
        <form
          className="stream-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {mismatch && (
            <p className="form-note">
              Chat is #{chatChannel}. This form updates the logged-in channel ({auth.login}).
            </p>
          )}
          <label>
            Title
            <textarea
              data-testid="stream-title"
              value={title}
              maxLength={TWITCH_TITLE_MAX}
              rows={3}
              onChange={(event) => {
                setTitle(event.target.value);
                setDirty(true);
              }}
            />
            <span className="count">{title.trim().length}/{TWITCH_TITLE_MAX}</span>
          </label>
          <label>
            Category
            <input
              data-testid="category-search"
              value={query}
              placeholder={gameName || "Search games"}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
            />
          </label>
          {gameName && <p className="picked">Selected: {gameName}</p>}
          {searchError && <p className="form-error">{searchError}</p>}
          {hits.length > 0 && (
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
                      setDirty(true);
                    }}
                  >
                    {hit.boxArtUrl && <img src={hit.boxArtUrl} alt="" />}
                    <span>{hit.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="tag-field">
            <label htmlFor="tag-input">Tags</label>
            <div className="chips">
              {tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="chip"
                  onClick={() => {
                    setTags((current) => current.filter((item) => item !== tag));
                    setDirty(true);
                  }}
                >
                  {tag}
                  <span aria-hidden="true">×</span>
                </button>
              ))}
            </div>
            <input
              id="tag-input"
              value={tagDraft}
              placeholder="Add a tag, then Enter"
              onChange={(event) => setTagDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === ",") {
                  event.preventDefault();
                  addTag(tagDraft);
                } else if (event.key === "Backspace" && !tagDraft && tags.length > 0) {
                  setTags((current) => current.slice(0, -1));
                  setDirty(true);
                }
              }}
            />
            <span className="count">{tags.length}/10 · letters and numbers only</span>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <button type="submit" className="primary" disabled={saving || !title.trim() || !gameId}>
              {saving ? "Saving" : "Update stream"}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                if (!stream) return;
                setTitle(stream.title);
                setGameId(stream.gameId);
                setGameName(stream.gameName);
                setTags(stream.tags);
                setDirty(false);
                setError(null);
              }}
            >
              Revert
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
