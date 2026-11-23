/** Desk colors. Overlay output defaults stay in chat-overlay.ts. */
export const theme = {
  bg: "#0C0D11",
  accent: "#C8873E",
  accentDeep: "#B07834",
  chocolate: "#5A3A22",
  cream: "#F3E3C8",
  onAccent: "#1C120A",
} as const;

export function relativeLuminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((index) => {
    const channel = parseInt(value.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

/** WCAG contrast ratio. 4.5 is AA for normal text; 3 is AA for large text and UI boundaries. */
export function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}
