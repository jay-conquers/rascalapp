import type { ReactNode } from "react";

/** Checkbox on the left, label immediately to the right. The whole row toggles. */
export function CheckRow({
  checked,
  onChange,
  disabled,
  id,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  children: ReactNode;
}) {
  return (
    <label className="check-row" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}
