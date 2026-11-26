/** Header status chip. Long labels ellipsize; narrow widths hide the detail and the word "watching". */
export function StatusPill({
  label,
  state,
  detail,
  viewers,
}: {
  label: string;
  state: string;
  detail: string;
  viewers?: number | null;
}) {
  const count = typeof viewers === "number" ? viewers.toLocaleString("en-US") : "";
  const watching = count ? `${count} watching` : "";
  const title = [detail, watching].filter(Boolean).join(" · ");
  return (
    <p className={`pill state-${state}`} title={title || label} aria-label={title || label}>
      <i aria-hidden="true" />
      <span className="pill-name" title={label}>
        {label}
      </span>
      {detail ? (
        <em className="pill-detail" title={detail}>
          {detail}
        </em>
      ) : null}
      {count ? (
        <strong className="viewers">
          <span className="viewer-count">{count}</span>
          <span className="viewer-word"> watching</span>
        </strong>
      ) : null}
    </p>
  );
}
