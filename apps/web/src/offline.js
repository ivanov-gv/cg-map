// The basemap archive: a PMTiles source that reads a verified local download when there is one, and the network
// otherwise. A download only becomes active after its size and SHA-256 match the release manifest.
import {formatBytes} from './core.js';

// Names the active verified download. Only a checksum-verified download writes it.
const activeMapStorageKey = 'kompas-active-map';
// The first block holds the PMTiles header and root directory, so most first reads are answered from it.
const firstBlockRange = 'bytes=0-16383';

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

async function sha256Hex(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

// Cleanup after a failure is best-effort: the original error is what the person needs to see.
async function ignoreCleanupFailure(cleanup) {
  try {
    await cleanup();
  } catch {
    /* Keep the original download result or error. */
  }
}

export class ArchiveSource {
  constructor(url, manifest) {
    this.url = url;
    this.manifest = manifest;
    this.remote = new pmtiles.FetchSource(url);
    // The verified local download, once active.
    this.local = null;
    // The origin-private directory downloads go to; null where the browser has none.
    this.directory = null;
    // A host that ignores Range sends the whole archive once; it is kept and sliced.
    this.onlineBlob = null;
    this.firstBlock = null;
    this.rangeProbe = null;
    this.filename = `map-${manifest.archive.sha256}.pmtiles`;
  }

  // PMTiles caches by this key.
  getKey() {
    return this.url;
  }

  get #archiveBytes() {
    return this.manifest.archive.bytes;
  }

  // Returns whether a verified download of this release is active. A missing or truncated file deactivates it.
  async init() {
    if (!navigator.storage?.getDirectory) return false;
    this.directory = await navigator.storage.getDirectory();
    if (localStorage.getItem(activeMapStorageKey) !== this.filename) return false;
    try {
      const handle = await this.directory.getFileHandle(this.filename);
      const file = await handle.getFile();
      if (file.size !== this.#archiveBytes) throw new Error('Incomplete local map');
      this.local = file;
      return true;
    } catch {
      localStorage.removeItem(activeMapStorageKey);
      return false;
    }
  }

  // The PMTiles Source interface. Reads come from the local download, a complete online copy, the first block, or a
  // range request, in that order.
  async getBytes(offset, length, signal, etag) {
    throwIfAborted(signal);
    if (this.local) return {data: await this.local.slice(offset, offset + length).arrayBuffer()};
    // Detect hosts that ignore Range once, then reuse their complete response.
    this.rangeProbe ??= this.#probeRangeSupport().catch(error => {
      this.rangeProbe = null;
      throw error;
    });
    await this.rangeProbe;
    throwIfAborted(signal);
    if (this.onlineBlob) return {data: await this.onlineBlob.slice(offset, offset + length).arrayBuffer()};
    const isInFirstBlock = this.firstBlock && offset + length <= this.firstBlock.byteLength;
    if (isInFirstBlock) return {data: this.firstBlock.slice(offset, offset + length)};
    return this.remote.getBytes(offset, length, signal, etag);
  }

  async #probeRangeSupport() {
    const response = await fetch(this.url, {headers: {Range: firstBlockRange}});
    if (response.status === 206) {
      this.firstBlock = await response.arrayBuffer();
      return;
    }
    if (response.status !== 200) throw new Error('Map request failed: HTTP ' + response.status);
    const blob = await response.blob();
    if (blob.size !== this.#archiveBytes) {
      throw new Error('The map package is incomplete. Check your connection and retry.');
    }
    this.onlineBlob = blob;
  }

  // Downloads, verifies and activates this release. onProgress(savedBytes, totalBytes) follows the archive transfer.
  // Returns {persisted, bytes}. Any failure or cancellation leaves the previously active download in place.
  async download(signal, onProgress) {
    if (!this.directory) {
      throw new Error('Offline downloads require HTTPS or localhost, and a browser with local file storage.');
    }
    await this.#requireStorageSpace();
    // Complete the shell first. A partial download never activates a new package.
    await this.#saveShell(signal);
    const response = await fetch(this.url, {signal, cache: 'no-store'});
    if (!response.ok) throw new Error('Map download failed: HTTP ' + response.status);
    const stagingName = this.filename + '.partial';
    const stagingHandle = await this.directory.getFileHandle(stagingName, {create: true});
    const stagingWriter = await stagingHandle.createWritable();
    try {
      const savedBytes = await this.#writeBody(response.body, stagingWriter, signal, onProgress);
      await stagingWriter.close();
      const staged = await stagingHandle.getFile();
      await this.#verify(staged);
      throwIfAborted(signal);
      await this.#activate(staged);
      const persisted = await navigator.storage.persist?.().catch(() => false);
      return {persisted, bytes: savedBytes};
    } catch (error) {
      await ignoreCleanupFailure(() => stagingWriter.abort());
      throw error;
    } finally {
      await this.directory.removeEntry(stagingName).catch(() => {});
    }
  }

  // Staging and the final copy exist together for a moment, so twice the archive must fit.
  async #requireStorageSpace() {
    const {quota, usage} = await navigator.storage.estimate();
    const hasRoom = !quota || !usage || quota - usage >= this.#archiveBytes * 2;
    if (!hasRoom) throw new Error('Not enough storage. Free some space and try again.');
  }

  async #saveShell(signal) {
    const shellCache = await caches.open(this.manifest.shellCache);
    for (const asset of this.manifest.shell) {
      throwIfAborted(signal);
      const url = new URL(asset, location.href);
      const response = await fetch(url, {cache: 'reload', signal});
      if (!response.ok) throw new Error('Could not save ' + asset);
      await shellCache.put(url, response);
    }
  }

  // Returns the number of bytes written.
  async #writeBody(body, writer, signal, onProgress) {
    const reader = body.getReader();
    let savedBytes = 0;
    while (true) {
      const {done, value} = await reader.read();
      if (done) return savedBytes;
      throwIfAborted(signal);
      await writer.write(value);
      savedBytes += value.byteLength;
      onProgress(savedBytes, this.#archiveBytes);
    }
  }

  async #verify(staged) {
    if (staged.size !== this.#archiveBytes) throw new Error('Incomplete map download. Please try again.');
    // This PoC archive is bounded (~12 MB). Hashing once temporarily uses that much RAM.
    const hash = await sha256Hex(staged);
    if (hash !== this.manifest.archive.sha256) throw new Error('Map integrity check failed. Please try again.');
  }

  // Copies the verified file into place, then switches the activation marker. An older active archive remains valid
  // until the marker changes, and is removed only after that.
  async #activate(staged) {
    const finalHandle = await this.directory.getFileHandle(this.filename, {create: true});
    const finalWriter = await finalHandle.createWritable();
    try {
      await staged.stream().pipeTo(finalWriter);
    } catch (error) {
      await ignoreCleanupFailure(() => finalWriter.abort());
      throw error;
    }
    const previousFilename = localStorage.getItem(activeMapStorageKey);
    localStorage.setItem(activeMapStorageKey, this.filename);
    this.local = await finalHandle.getFile();
    this.onlineBlob = null;
    this.firstBlock = null;
    this.rangeProbe = null;
    if (previousFilename && previousFilename !== this.filename) {
      await this.directory.removeEntry(previousFilename).catch(() => {});
    }
  }

  async remove() {
    this.local = null;
    const activeFilename = localStorage.getItem(activeMapStorageKey);
    localStorage.removeItem(activeMapStorageKey);
    if (activeFilename && this.directory) await this.directory.removeEntry(activeFilename).catch(() => {});
  }
}

export function downloadLabel(manifest) {
  return 'Download offline · ' + formatBytes(manifest.totalBytes);
}
