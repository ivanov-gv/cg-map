// Single definition of device-class media queries.
// CSS rules in style.css must use the same conditions; see the comment at the top of that file.
// JavaScript code that needs the device class should use deviceClass(matchMedia) below.

// Flip: small cover screens that are nearly square (Galaxy Z Flip ~340–380 px per side).
// The 400 px limit on both axes excludes phones in landscape (width > 400) and portrait (height > 400).
export const FLIP_MEDIA_QUERY = '(max-width: 400px) and (max-height: 400px)';

// Mobile: phones and small tablets in portrait. This query also matches Flip viewports,
// but deviceClass() checks Flip first and excludes them from the mobile class.
// Flip-specific CSS rules must come after the Mobile block and override it.
export const MOBILE_MEDIA_QUERY = '(max-width: 720px)';

// Desktop: the complement of the mobile query (721 = 720 + 1).
export const DESKTOP_MEDIA_QUERY = '(min-width: 721px)';

/**
 * Returns 'flip', 'mobile', or 'desktop' for the current viewport.
 * @param {typeof window.matchMedia} matchMedia - factory for MediaQueryList objects (injectable for tests).
 * @returns {'flip' | 'mobile' | 'desktop'}
 */
export function deviceClass(matchMedia) {
  const flipQuery = matchMedia(FLIP_MEDIA_QUERY);
  const mobileQuery = matchMedia(MOBILE_MEDIA_QUERY);
  if (flipQuery.matches) return 'flip';
  if (mobileQuery.matches) return 'mobile';
  return 'desktop';
}
