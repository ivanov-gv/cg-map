// What the service worker needs that does not depend on a worker environment, so it can be tested directly.

// Returns [first, last] for one HTTP byte range, or null when it cannot be satisfied.
export function parseByteRange(rangeHeader, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match || (!match[1] && !match[2])) return null;
  const [, firstText, lastText] = match;
  const first = firstText ? Number(firstText) : Math.max(0, size - Number(lastText));
  const last = firstText && lastText ? Math.min(Number(lastText), size - 1) : size - 1;
  const isSuffixOfNothing = !firstText && Number(lastText) === 0;
  return first > last || isSuffixOfNothing ? null : [first, last];
}

// Answers a map tile read from the one stored copy of the archive. A blob slice reads only the requested bytes, so a
// tile does not load the whole archive into memory. Partial responses themselves are never stored.
export async function byteRangeResponse(storedResponse, rangeHeader) {
  if (!rangeHeader) return storedResponse;
  const archive = await storedResponse.blob();
  const range = parseByteRange(rangeHeader, archive.size);
  if (!range) return new Response(null, {status: 416, headers: {'Content-Range': `bytes */${archive.size}`}});
  const [first, last] = range;
  const headers = {
    'Content-Type': archive.type,
    'Content-Length': String(last - first + 1),
    'Content-Range': `bytes ${first}-${last}/${archive.size}`,
    'Accept-Ranges': 'bytes'
  };
  return new Response(archive.slice(first, last + 1), {status: 206, headers});
}
