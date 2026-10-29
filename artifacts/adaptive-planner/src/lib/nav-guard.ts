/** Lightweight in-memory guard so the shell can confirm before leaving a dirty screen. No persistence. */
let message: string | null = null;

export function setNavGuard(msg: string | null) {
  message = msg;
}
export function getNavGuard() {
  return message;
}
export const NAV_REQUEST_EVENT = 'align:nav-request';
/** Returns true when navigation was intercepted (caller should preventDefault). */
export function interceptNav(href: string) {
  if (!message) return false;
  window.dispatchEvent(new CustomEvent(NAV_REQUEST_EVENT, { detail: href }));
  return true;
}
