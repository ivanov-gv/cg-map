// Decides when asking for an update takeover can succeed. The browser answers the first request by stopping the active
// worker, and a map read arriving in that moment restarts it. Later requests do not stop it again, so the new version
// then waits for the browser's own limit of 5 minutes, or until every window closes. So every window finishes loading its
// map first. Measured in the three-window browser test: about 1 run in 40 was held this way.
const channelName = 'editor-update-quiet';
const pollMilliseconds = 100;
// How long open windows get to say that they exist. A window that stays silent cannot be waited for.
const defaultAnswerMilliseconds = 300;
// A map that never settles, or a frozen background window, must not stop the update.
const defaultMaximumWaitMilliseconds = 5000;

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

// Resolves once isQuiet holds, or at the deadline.
async function waitUntilQuiet(isQuiet, deadline) {
  while (!isQuiet() && Date.now() < deadline) await pause(pollMilliseconds);
}

// Makes this window take part when another one asks. Returns the channel, which the caller closes to stop answering.
export function answerQuietRequests(isQuiet, maximumWaitMilliseconds = defaultMaximumWaitMilliseconds) {
  const channel = new BroadcastChannel(channelName);
  channel.onmessage = async ({data}) => {
    if (data.type !== 'are-you-quiet') return;
    channel.postMessage({type: 'waiting', requestId: data.requestId});
    await waitUntilQuiet(isQuiet, Date.now() + maximumWaitMilliseconds);
    channel.postMessage({type: 'quiet', requestId: data.requestId});
  };
  return channel;
}

// Resolves once this window and every window that answered are quiet, and always within the maximum wait.
export async function whenEveryWindowIsQuiet(
  isQuiet,
  {
    answerMilliseconds = defaultAnswerMilliseconds,
    maximumWaitMilliseconds = defaultMaximumWaitMilliseconds
  } = {}
) {
  const deadline = Date.now() + maximumWaitMilliseconds;
  const requestId = crypto.randomUUID();
  const channel = new BroadcastChannel(channelName);
  let waitingWindows = 0;
  channel.onmessage = ({data}) => {
    if (data.requestId !== requestId) return;
    waitingWindows += data.type === 'waiting' ? 1 : -1;
  };
  channel.postMessage({type: 'are-you-quiet', requestId});
  await pause(answerMilliseconds);
  await waitUntilQuiet(() => isQuiet() && waitingWindows === 0, deadline);
  channel.close();
}
