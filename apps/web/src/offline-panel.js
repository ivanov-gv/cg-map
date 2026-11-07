// The dock's offline controls: download, cancel and remove the verified map, and the connection badge.
// ArchiveSource owns storage and verification; this module only presents it.
import {basemapURL} from './data-mode.js';
import {elementById} from './dom.js';
import {downloadLabel} from './offline.js';

const insecureStorageNote = 'Use HTTPS or localhost with a browser supporting local file storage to enable downloads.';

// context: {archive, manifest, endpoints, hasServiceWorker, map(), notify(message), clearNotice()}
export class OfflinePanel {
  #context;
  #downloadController = null;

  constructor(context) {
    this.#context = context;
  }

  // Never throws: without local storage the online map still works, and the note says so.
  async initialize() {
    try {
      await this.#context.archive.init();
    } catch {
      this.#showStorageNote('Local storage unavailable. Online map is still usable.');
    }
    this.render();
    elementById('download').addEventListener('click', () => this.#download());
    elementById('cancel-download').addEventListener('click', () => this.#downloadController?.abort());
    elementById('remove-download').addEventListener('click', () => this.#remove());
    addEventListener('online', () => this.#renderConnection());
    addEventListener('offline', () => this.#renderConnection());
  }

  render() {
    const {archive, manifest, hasServiceWorker} = this.#context;
    this.#refreshBasemap();
    const isSaved = Boolean(archive.local);
    const canStore = Boolean(archive.directory);
    elementById('download-title').textContent = isSaved ? 'Map saved for offline use' : 'Download for offline use';
    elementById('download').title = downloadLabel(manifest);
    elementById('download-state').textContent = isSaved ? 'READY' : '';
    elementById('download').disabled = isSaved || !canStore || !hasServiceWorker;
    elementById('remove-download').hidden = !isSaved;
    if (!canStore) this.#showStorageNote(insecureStorageNote);
    this.#renderConnection();
  }

  #showStorageNote(message) {
    elementById('storage-note').textContent = message;
    elementById('storage-note').hidden = !message;
  }

  // Connection state only; it carries no location meaning. Online with no saved map needs no badge.
  #renderConnection() {
    const isSaved = Boolean(this.#context.archive.local);
    const offlineText = isSaved ? 'Offline · saved map' : 'Offline · download needed';
    const onlineText = isSaved ? 'Saved map in use' : '';
    const text = navigator.onLine ? onlineText : offlineText;
    elementById('connection').textContent = text;
    elementById('connection').hidden = !text;
  }

  // In server mode a download or removal during the session switches the basemap between the API and the verified
  // local archive, so offline use never depends on uncached API tiles.
  #refreshBasemap() {
    const {archive, endpoints, map} = this.#context;
    const source = map()?.getSource('basemap');
    const url = basemapURL(endpoints, archive.url, Boolean(archive.local));
    if (source && source.url !== url) source.setUrl(url);
  }

  #showProgress(savedBytes, totalBytes) {
    const percent = (savedBytes / totalBytes) * 100;
    elementById('download-progress').value = percent;
    elementById('download-title').textContent = `Saving map… ${Math.min(100, Math.round(percent))}%`;
  }

  #setDownloading(isDownloading) {
    elementById('cancel-download').hidden = !isDownloading;
    elementById('download-progress').hidden = !isDownloading;
    if (isDownloading) elementById('download').disabled = true;
  }

  async #download() {
    if (this.#downloadController) return;
    this.#downloadController = new AbortController();
    this.#setDownloading(true);
    this.#context.clearNotice();
    try {
      await navigator.serviceWorker.ready;
      const onProgress = (savedBytes, totalBytes) => this.#showProgress(savedBytes, totalBytes);
      const result = await this.#context.archive.download(this.#downloadController.signal, onProgress);
      this.#showStorageNote(
        result.persisted
          ? 'Saved on this device. Ready for offline use.'
          : 'Saved. Your browser may remove downloads when storage is low.'
      );
    } catch (error) {
      if (error.name === 'AbortError') this.#showStorageNote('Download cancelled. Existing downloads remain available.');
      else this.#context.notify(error.message);
    } finally {
      this.#downloadController = null;
      this.#setDownloading(false);
      this.render();
    }
  }

  async #remove() {
    try {
      await this.#context.archive.remove();
      this.#showStorageNote('');
      this.render();
    } catch (error) {
      this.#context.notify('Could not remove offline map: ' + error.message);
    }
  }
}
