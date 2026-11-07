import http from 'node:http';
import fileSystem from 'node:fs';

const contentTypes = {
  'sw.js': 'text/javascript',
  'offline-manifest.js': 'text/javascript',
  'app-updates.js': 'text/javascript',
  'version.txt': 'text/plain'
};

// Serve one controlled release, including real worker requests that page route mocks cannot intercept.
function serveRelease(request, response, state, scope) {
  const assetPath = new URL(request.url, 'http://localhost').pathname.slice(scope.length);
  const isWorkerScript = ['sw.js', 'offline-manifest.js'].includes(assetPath);
  response.setHeader('Content-Type', contentTypes[assetPath] ?? 'text/html');
  response.setHeader('Cache-Control', isWorkerScript ? 'no-cache' : 'public, max-age=3600');
  if (assetPath === 'sw.js' || assetPath === 'app-updates.js') {
    const artifactURL = new URL(`../../../../dist/web/${assetPath}`, import.meta.url);
    response.end(fileSystem.readFileSync(artifactURL));
    return;
  }
  if (assetPath === 'offline-manifest.js') {
    const manifest = {
      shellCache: 'kompas-shell-update-test-' + state.version,
      shell: ['index.html', 'app-updates.js', 'version.txt']
    };
    response.end('self.KOMPAS_OFFLINE=' + JSON.stringify(manifest) + ';');
    return;
  }
  if (assetPath === 'version.txt') {
    if (state.isIncomplete) {
      state.failures++;
      response.statusCode = 503;
      response.end('Incomplete release');
      return;
    }
    response.end(String(state.version));
    return;
  }
  response.end(`<!doctype html><title>Update fixture</title><p id="version">${state.version}</p>
<script>
  sessionStorage.loads = String(Number(sessionStorage.loads || 0) + 1);
</script>
<script type="module">
  import {registerAppUpdates} from './app-updates.js';
  window.registration = await registerAppUpdates();
</script>`);
}

// The test can publish an incomplete or complete release, observe failed asset requests, then close every socket.
export async function startUpdateServer(scope) {
  const state = {version: 1, isIncomplete: false, failures: 0};
  const server = http.createServer((request, response) => serveRelease(request, response, state, scope));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}${scope}`,
    release(nextVersion, isIncomplete = false) {
      state.version = nextVersion;
      state.isIncomplete = isIncomplete;
    },
    get failures() {
      return state.failures;
    },
    close: () =>
      new Promise(resolve => {
        server.close(resolve);
        server.closeAllConnections();
      })
  };
}
