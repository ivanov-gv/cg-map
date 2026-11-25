// Whether points go to what is close to them. A convenience of this browser, so it works without its storage too.
const storageName = 'kompas-editor-magnet';
let isOn = readSwitch();

function readSwitch() {
  try {
    return globalThis.localStorage?.getItem(storageName) !== 'off';
  } catch {
    return true;
  }
}

export const isMagnetOn = () => isOn;

export function setMagnetOn(isWanted) {
  isOn = isWanted;
  try {
    globalThis.localStorage?.setItem(storageName, isWanted ? 'on' : 'off');
  } catch {
    // The switch still holds until the page is closed.
  }
}
