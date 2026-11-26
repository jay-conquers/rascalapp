import type { SVGProps } from "react";
import iconSource from "../../../build/icon.svg?raw";

type IconProps = SVGProps<SVGSVGElement>;

const iconMarkup = iconSource.replace(/^[\s\S]*?<svg\b[^>]*>/i, "").replace(/<\/svg>\s*$/i, "");
const iconViewBox = iconSource.match(/viewBox="([^"]+)"/i)?.[1] ?? "0 0 1024 1024";

/** Renders build/icon.svg. The PNG icons are rasterized from that same file. */
export function RascalMark(props: IconProps) {
  return <svg viewBox={iconViewBox} aria-hidden="true" {...props} dangerouslySetInnerHTML={{ __html: iconMarkup }} />;
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
