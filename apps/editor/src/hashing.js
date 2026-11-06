// Lowercase hex SHA-256 of bytes or text, the form every base hash and fingerprint in a changeset uses.
export async function sha256Hex(content) {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

// The key order of the pinned source is part of the fingerprint, as the changeset contract states.
export const featureFingerprint = feature => sha256Hex(JSON.stringify(feature));
