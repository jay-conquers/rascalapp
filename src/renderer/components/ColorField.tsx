import { useEffect, useState } from "react";

function swatchColor(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000";
}

/** Visible swatch plus a hex field. Partial hex edits stay local until they are complete. */
export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => {
    setText(value);
  }, [value]);

  return (
    <label className="color-field">
      <span>{label}</span>
      <span className="color-field-row">
        <input
          type="color"
          aria-label={`${label} swatch`}
          value={swatchColor(value)}
          onChange={(event) => onChange(event.target.value.toLowerCase())}
        />
        <input
          className="color-hex"
          aria-label={`${label} hex`}
          spellCheck={false}
          value={text}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            if (/^#[0-9a-fA-F]{6}$/.test(next)) onChange(next.toLowerCase());
          }}
          onBlur={() => {
            if (!/^#[0-9a-fA-F]{6}$/.test(text)) setText(value);
          }}
        />
      </span>
    </label>
  );
}
