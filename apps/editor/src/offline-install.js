import {elementById} from './dom.js';

const readyMessage = 'Saved on this device. Works offline.';

function showOfflineStatus(message, isProblem = false) {
  const status = elementById('offline-status');
  status.textContent = message;
  status.setAttribute('role', isProblem ? 'alert' : 'status');
  status.classList.toggle('problem', isProblem);
}

// The new release is already stored, so taking over needs no network. Reloading only after this click means an update
// can never replace the page by itself.
function offerUpdate(worker) {
  showOfflineStatus('A new version is ready.');
  const button = elementById('update-app');
  button.hidden = false;
  button.onclick = () => {
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), {once: true});
    worker.postMessage({type: 'activate-update'});
  };
}

function followInstall(worker, registration) {
  showOfflineStatus(registration.active ? 'Downloading a new version…' : 'Saving the editor on this device…');
  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed' && registration.active) offerUpdate(worker);
    if (worker.state === 'activated') showReady();
    if (worker.state !== 'redundant' || registration.waiting) return;
    if (registration.active) showOfflineStatus('The update failed. This version keeps working.', true);
    else showOfflineStatus('Could not save the editor for offline use. Reload to try again.', true);
  });
}

// An installed app is normally granted this. Without it the browser may clear the offline copy when short of space.
function showReady() {
  showOfflineStatus(readyMessage);
  navigator.storage?.persist?.().catch(() => {});
}

// Never stops the editor from opening: everything here only decides whether it also works offline.
export async function startOfflineCopy() {
  if (!('serviceWorker' in navigator) || !isSecureContext) {
    showOfflineStatus('Installing and offline use need HTTPS or localhost.', true);
    return;
  }
  try {
    const options = {scope: './', type: 'module', updateViaCache: 'none'};
    const registration = await navigator.serviceWorker.register('sw.js', options);
    // Browser tests outside the offline suite block workers, and register then returns nothing.
    if (!registration) return;
    registration.addEventListener('updatefound', () => followInstall(registration.installing, registration));
    if (registration.waiting) offerUpdate(registration.waiting);
    else if (registration.installing) followInstall(registration.installing, registration);
    else if (registration.active) showReady();
  } catch (error) {
    showOfflineStatus(`Could not save the editor for offline use: ${error.message}`, true);
  }
}
