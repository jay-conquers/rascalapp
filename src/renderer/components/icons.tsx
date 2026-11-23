import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

/** Keep this drawing in sync with build/icon.svg. The PNG icons are rendered from that file. */
export function RascalMark(props: IconProps) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" {...props}>
      <circle cx="16" cy="16" r="16" fill="#2B2B2B" />
      <path d="M21.4 25.2C25.6 27.2 29.4 24.2 27.8 20.4C26.6 17.6 23.6 18 24.4 20.6C25 22.6 22.8 23.6 21.2 22.6" fill="none" stroke="#C48A4A" strokeWidth="3.15" strokeLinecap="round" />
      <path d="M21.4 25.2C25.6 27.2 29.4 24.2 27.8 20.4C26.6 17.6 23.6 18 24.4 20.6C25 22.6 22.8 23.6 21.2 22.6" fill="none" stroke="#5A3A22" strokeWidth="3.15" strokeLinecap="butt" strokeDasharray="1.7 2.15" />
      <path d="M11 16.6C8.2 19.2 8.4 25 11.6 27.8C14.8 30.4 22.2 30.2 25.2 27C28 23.8 27.4 18.2 23.6 16C20 18.6 14.4 18.6 11 16.6Z" fill="#C48A4A" />
      <ellipse cx="14.8" cy="16.6" rx="4.4" ry="3.5" fill="#C48A4A" />
      <path d="M16.2 18.4C19.2 17.5 22.6 17.9 25.2 19.4" fill="none" stroke="#5A3A22" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M15.2 21.4C18.8 20.3 23 20.8 25.6 22.4" fill="none" stroke="#5A3A22" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M14.6 24.3C18.2 23.3 22.6 23.8 25 25.3" fill="none" stroke="#5A3A22" strokeWidth="1.55" strokeLinecap="round" />
      <ellipse cx="13.4" cy="24.8" rx="2.7" ry="3.1" fill="#F3E3C8" />
      <path d="M6.6 12.4L4.8 5.4L11.4 10.2Z" fill="#C48A4A" />
      <path d="M11.2 9.4L14.2 4.2L16.6 11.2Z" fill="#C48A4A" />
      <circle cx="11" cy="13.6" r="5.05" fill="#C48A4A" />
      <path d="M7.2 11.2L6.2 7.4L10.6 10.2Z" fill="#E7C9A4" />
      <path d="M12 9.4L14 6.2L15.4 10.8Z" fill="#E7C9A4" />
      <ellipse cx="9.3" cy="15.1" rx="2.85" ry="2.15" fill="#F3E3C8" />
      <path d="M7.2 12.8Q9.1 11.3 10.9 12.7" fill="none" stroke="#4A2F1C" strokeWidth="1.15" strokeLinecap="round" />
      <path d="M10.6 12.3Q12.4 10.9 14.1 12.3" fill="none" stroke="#4A2F1C" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

export function TwitchMark(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="currentColor"
        d="M5 3h15v10.2l-4.2 4.2H12L9.2 20H7.2v-2.6H3V6.2L5 3zm2.1 2.1v10.4h3.2V18l2.6-2.5h3.6l2.4-2.4V5.1H7.1zm8.2 2.2h1.6v4.6h-1.6V7.3zm-4.2 0h1.6v4.6h-1.6V7.3z"
      />
    </svg>
  );
}

export function YouTubeMark(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="currentColor"
        d="M21.2 7.4a2.7 2.7 0 0 0-1.9-1.9C17.6 5 12 5 12 5s-5.6 0-7.3.5a2.7 2.7 0 0 0-1.9 1.9C2.3 9.1 2.3 12 2.3 12s0 2.9.5 4.6a2.7 2.7 0 0 0 1.9 1.9C6.4 19 12 19 12 19s5.6 0 7.3-.5a2.7 2.7 0 0 0 1.9-1.9c.5-1.7.5-4.6.5-4.6s0-2.9-.5-4.6zM10.2 15.1V8.9L15.6 12l-5.4 3.1z"
      />
    </svg>
  );
}

export function PinIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="currentColor"
        d="M14.2 3.5a1 1 0 0 1 1.6.2l1.2 1.8a4.8 4.8 0 0 1 .2 4.6l1.7 1.7a1 1 0 0 1-.3 1.6l-3.3 1.4-.8 4.6a1 1 0 0 1-1.7.5l-2.4-2.8-3.6 3.6a1 1 0 0 1-1.4-1.4l3.6-3.6-2.8-2.4a1 1 0 0 1 .5-1.7l4.6-.8 1.4-3.3a1 1 0 0 1 .5-.4z"
      />
    </svg>
  );
}

export function GearIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="currentColor"
        d="M10.2 2.8h3.6l.4 2.2a7.2 7.2 0 0 1 1.8 1l2-1 2.5 2.5-1 2a7.2 7.2 0 0 1 1 1.8l2.2.4v3.6l-2.2.4a7.2 7.2 0 0 1-1 1.8l1 2-2.5 2.5-2-1a7.2 7.2 0 0 1-1.8 1l-.4 2.2h-3.6l-.4-2.2a7.2 7.2 0 0 1-1.8-1l-2 1-2.5-2.5 1-2a7.2 7.2 0 0 1-1-1.8l-2.2-.4V9.8l2.2-.4a7.2 7.2 0 0 1 1-1.8l-1-2 2.5-2.5 2 1a7.2 7.2 0 0 1 1.8-1l.4-2.2zM12 9.2A2.8 2.8 0 1 0 12 14.8 2.8 2.8 0 0 0 12 9.2z"
      />
    </svg>
  );
}
