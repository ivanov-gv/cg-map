import {formatBytes} from './core.js';
// Adapts verified local files or HTTP range reads to the PMTiles source interface.
export class ArchiveSource {
  constructor(url, manifest) {
    this.url = url;
    this.manifest = manifest;
    this.remote = new pmtiles.FetchSource(url);
    this.local = null;
    this.directory = null;
    this.onlineBlob = null;
    this.firstBlock = null;
    this.transportReady = null;
    this.filename = 'map-' + manifest.archive.sha256 + '.pmtiles';
  }
  getKey() {
    return this.url;
  }
  // Reopen only the content-addressed file named by a successful download.
  async init() {
    if (!navigator.storage?.getDirectory) return false;
    this.directory = await navigator.storage.getDirectory();
    // Only a checksum-verified download writes this activation marker.
    if (localStorage.getItem('kompas-active-map') !== this.filename) return false;
    try {
      const handle = await this.directory.getFileHandle(this.filename);
      const file = await handle.getFile();
      if (file.size !== this.manifest.archive.bytes) throw new Error('Incomplete local map');
      this.local = file;
      return true;
    } catch {
      localStorage.removeItem('kompas-active-map');
      return false;
    }
  }
  // Local and whole-response reads return slices; range-capable hosts stay remote.
  async getBytes(offset, length, signal, etag) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (this.local) return {data: await this.local.slice(offset, offset + length).arrayBuffer()};
    // Detect hosts that ignore Range once, then reuse their complete response.
    if (!this.transportReady)
      this.transportReady = this.prepareTransport().catch(error => {
        this.transportReady = null;
        throw error;
      });
    await this.transportReady;
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (this.onlineBlob) return {data: await this.onlineBlob.slice(offset, offset + length).arrayBuffer()};
    if (this.firstBlock && offset + length <= this.firstBlock.byteLength)
      return {data: this.firstBlock.slice(offset, offset + length)};
    return this.remote.getBytes(offset, length, signal, etag);
  }
  // Probe range support once; hosts returning the whole archive share one in-memory blob.
  async prepareTransport() {
    const response = await fetch(this.url, {headers: {Range: 'bytes=0-16383'}});
    if (response.status === 206) {
      this.firstBlock = await response.arrayBuffer();
      return;
    }
    if (response.status !== 200) throw new Error('Map request failed: HTTP ' + response.status);
    const blob = await response.blob();
    if (blob.size !== this.manifest.archive.bytes)
      throw new Error('The map package is incomplete. Check your connection and retry.');
    this.onlineBlob = blob;
  }
  // Stage, verify, then activate. The previous version survives a failed replacement.
  async download(signal, onProgress) {
    if (!this.directory)
      throw new Error('Offline downloads require HTTPS or localhost, and a browser with local file storage.');
    const estimate = await navigator.storage.estimate();
    if (estimate.quota && estimate.usage && estimate.quota - estimate.usage < this.manifest.archive.bytes * 2)
      throw new Error('Not enough storage. Free some space and try again.');
    await this.saveShell(signal);
    const response = await fetch(this.url, {signal, cache: 'no-store'});
    if (!response.ok) throw new Error('Map download failed: HTTP ' + response.status);
    const staging = this.filename + '.partial';
    const handle = await this.directory.getFileHandle(staging, {create: true});
    const writable = await handle.createWritable();
    try {
      const downloadedBytes = await this.writeDownload(response, writable, signal, onProgress);
      const staged = await handle.getFile();
      await this.verifyDownload(staged);
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const finalHandle = await this.copyVerifiedDownload(staged);
      // Reopen before committing: a storage read failure must preserve the previous marker too.
      const completedFile = await finalHandle.getFile();
      const previousFilename = localStorage.getItem('kompas-active-map');
      localStorage.setItem('kompas-active-map', this.filename);
      this.local = completedFile;
      this.onlineBlob = null;
      this.firstBlock = null;
      this.transportReady = null;
      if (previousFilename && previousFilename !== this.filename)
        await this.directory.removeEntry(previousFilename).catch(() => {});
      const persisted = await navigator.storage.persist?.().catch(() => false);
      return {persisted, bytes: downloadedBytes};
    } catch (error) {
      try {
        await writable.abort();
      } catch {
        /* Best-effort cleanup; keep the original download result/error. */
      }
      throw error;
    } finally {
      await this.directory.removeEntry(staging).catch(() => {});
    }
  }
  // Complete the shell before the archive. A partial download never activates a new package.
  async saveShell(signal) {
    const shell = await caches.open(this.manifest.shellCache);
    for (const asset of this.manifest.shell) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const url = new URL(asset, location.href);
      const response = await fetch(url, {cache: 'reload', signal});
      if (!response.ok) throw new Error('Could not save ' + asset);
      await shell.put(url, response);
    }
  }

  // Progress reports only bytes written to staging; the active file is never streamed into.
  async writeDownload(response, writable, signal, onProgress) {
    const reader = response.body.getReader();
    let downloadedBytes = 0;
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      await writable.write(value);
      downloadedBytes += value.byteLength;
      onProgress(downloadedBytes, this.manifest.archive.bytes);
    }
    await writable.close();
    return downloadedBytes;
  }

  // This PoC archive is bounded (~12 MB). Hashing once temporarily uses that much RAM.
  async verifyDownload(staged) {
    if (staged.size !== this.manifest.archive.bytes) {
      throw new Error('Incomplete map download. Please try again.');
    }
    const bytes = await staged.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== this.manifest.archive.sha256) {
      throw new Error('Map integrity check failed. Please try again.');
    }
  }

  // Copy only after verification. A failed write keeps its original error through cleanup.
  async copyVerifiedDownload(staged) {
    const finalHandle = await this.directory.getFileHandle(this.filename, {create: true});
    const finalWriter = await finalHandle.createWritable();
    try {
      await staged.stream().pipeTo(finalWriter);
    } catch (error) {
      try {
        await finalWriter.abort();
      } catch {
        // Best-effort cleanup; keep the original download error.
      }
      throw error;
    }
    return finalHandle;
  }

  async remove() {
    this.local = null;
    const active = localStorage.getItem('kompas-active-map');
    localStorage.removeItem('kompas-active-map');
    if (active && this.directory) await this.directory.removeEntry(active).catch(() => {});
  }
}
export function downloadLabel(manifest) {
  return 'Download offline · ' + formatBytes(manifest.totalBytes);
}
