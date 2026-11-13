// Single definition of device-class media queries.
// CSS rules in style.css must use the same conditions; see the comment at the top of that file.
// JavaScript code that needs the device class should use deviceClass(matchMedia) below.

// Flip: small cover screens that are nearly square (Galaxy Z Flip ~340–380 px per side).
// The 400 px limit on both axes excludes phones in landscape (width > 400) and portrait (height > 400).
export const FLIP_MEDIA_QUERY = '(max-width: 400px) and (max-height: 400px)';

// Mobile: phones and small tablets in portrait, excluding Flip.
export const MOBILE_MEDIA_QUERY = '(max-width: 720px)';

/**
 * Returns 'flip', 'mobile', or 'desktop' for the current viewport.
 * @param {typeof window.matchMedia} matchMedia - factory for MediaQueryList objects (injectable for tests).
 * @returns {'flip' | 'mobile' | 'desktop'}
 */
export function deviceClass(matchMedia) {
  const flipMql = matchMedia(FLIP_MEDIA_QUERY);
  const mobileMql = matchMedia(MOBILE_MEDIA_QUERY);
  if (flipMql.matches) return 'flip';
  if (mobileMql.matches) return 'mobile';
  return 'desktop';
}
