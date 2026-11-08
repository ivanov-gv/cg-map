import {elementById} from './dom.js';
import {answerQuietRequests, whenEveryWindowIsQuiet} from './update-quiet.js';

const readyMessage = 'Saved on this device. Works offline.';
const updateRetryMilliseconds = 1000;
const updateHintDelayMilliseconds = 10000;
// Set once a new version has taken over a window that cannot reload yet. Its warning must then stay on screen.
let isAwaitingReload = false;
let isMapQuiet = () => true;
let isOfflineProblem = false;
let isUpdateOffered = false;

// Both an offline problem and an available update need a visible route into Layers.
function updateOfflineNotice() {
  elementById('offline-notice').hidden = !isOfflineProblem && !isUpdateOffered;
}

function showOfflineStatus(message, isProblem = false) {
  if (isAwaitingReload) return;
  const status = elementById('offline-status');
  status.textContent = message;
  status.setAttribute('role', isProblem ? 'alert' : 'status');
  status.classList.toggle('problem', isProblem);
  isOfflineProblem = isProblem;
  updateOfflineNotice();
}

// The new release is already stored, so taking over needs no network.
function offerUpdate(worker, message = 'A new version is ready.') {
  showOfflineStatus(message);
  const button = elementById('update-app');
  button.hidden = false;
  isUpdateOffered = true;
  updateOfflineNotice();
  button.onclick = async () => {
    hideUpdateOffer();
    showOfflineStatus('Updating…');
    await whenEveryWindowIsQuiet(isMapQuiet);
    askUntilTakeover(worker);
  };
}

// A request can still lose the race described in update-quiet.js, for example to someone moving a map, and then the browser
// waits for every window to close. So ask until the takeover reloads this page, and say how to finish if it never does.
function askUntilTakeover(worker) {
  // A newer version can replace this one during the wait for quiet windows, and it makes its own offer.
  if (worker.state !== 'installed') return;
  const startedAt = Date.now();
  const ask = () => worker.postMessage({type: 'activate-update'});
  ask();
  const retry = setInterval(() => {
    if (worker.state !== 'installed') {
      clearInterval(retry);
      return;
    }
    ask();
    if (Date.now() - startedAt > updateHintDelayMilliseconds) {
      showOfflineStatus('The update is ready. Close every editor window and open it again to finish.', true);
    }
  }, updateRetryMilliseconds);
}

function hideUpdateOffer() {
  elementById('update-app').hidden = true;
  isUpdateOffered = false;
  updateOfflineNotice();
}

function reportFailedInstall(registration) {
  if (registration.waiting)
    offerUpdate(registration.waiting, 'A new version is ready. A newer one failed to download.');
  else if (registration.active) showOfflineStatus('The update failed. This version keeps working.', true);
  else showOfflineStatus('Could not save the editor for offline use. Reload to try again.', true);
}

// While a newer version downloads, any offer would point at a version that is about to be out of date.
function followInstall(worker, registration) {
  hideUpdateOffer();
  showOfflineStatus(registration.active ? 'Downloading a new version…' : 'Saving the editor on this device…');
  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed' && registration.active) offerUpdate(worker);
    if (worker.state === 'activated') showReady();
    if (worker.state === 'redundant') reportFailedInstall(registration);
  });
}

// An installed app is normally granted this. Without it the browser may clear the offline copy when short of space, and
// the drafts with it, so saying "works offline" alone would promise too much.
async function showReady() {
  showOfflineStatus(readyMessage);
  const isPersistent = await navigator.storage?.persist?.().catch(() => false);
  if (isPersistent === false) showOfflineStatus(`${readyMessage} The browser may clear it if storage runs low.`, true);
}

// A new version takes over every window, whichever one asked. Each must reload, because old code against new files can
// lose its map. A window holding work it has not saved keeps running and says so, rather than reloading it away.
// The first install also changes the controller, from none, and needs no reload.
function reloadOnTakeover(canReloadNow) {
  let hasController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const isFirstInstall = !hasController;
    hasController = true;
    if (isFirstInstall) return;
    if (canReloadNow()) {
      location.reload();
      return;
    }
    hideUpdateOffer();
    showOfflineStatus('A new version took over. Finish and save your work, then reload.', true);
    isAwaitingReload = true;
  });
}

// Never stops the editor from opening: everything here only decides whether it also works offline.
export async function startOfflineCopy(canReloadNow, isQuiet) {
  if (!('serviceWorker' in navigator) || !isSecureContext) {
    showOfflineStatus('Installing and offline use need HTTPS or localhost.', true);
    return;
  }
  try {
    const options = {scope: './', type: 'module', updateViaCache: 'none'};
    const registration = await navigator.serviceWorker.register('sw.js', options);
    // Browser tests outside the offline suite block workers, and register then returns nothing.
    if (!registration) return;
    isMapQuiet = isQuiet;
    answerQuietRequests(isMapQuiet);
    reloadOnTakeover(canReloadNow);
    registration.addEventListener('updatefound', () => followInstall(registration.installing, registration));
    if (registration.installing) followInstall(registration.installing, registration);
    else if (registration.waiting) offerUpdate(registration.waiting);
    else if (registration.active) showReady();
  } catch (error) {
    showOfflineStatus(`Could not save the editor for offline use: ${error.message}`, true);
  }
}
