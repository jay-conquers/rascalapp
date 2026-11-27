/**
 * Permissions the desk window may use.
 * Speaker selection lists audio outputs and routes the message chime.
 * Clipboard write keeps the overlay address copy button working.
 * Camera, microphone, and screen capture stay off.
 */
const ALLOWED_RENDERER_PERMISSIONS = new Set(["speaker-selection", "clipboard-sanitized-write"]);

export function grantRendererPermission(permission: string): boolean {
  return ALLOWED_RENDERER_PERMISSIONS.has(permission);
}
