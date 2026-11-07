import http from 'node:http';
import fs from 'node:fs';

const builtFile = filename => fs.readFileSync(new URL(`../../../../dist/web/${filename}`, import.meta.url));
const contentTypes = {
  'sw.js': 'text/javascript',
  'offline-manifest.js': 'text/javascript',
  'app-updates.js': 'text/javascript',
  'version.txt': 'text/plain'
};
// The worker and its manifest are revalidated on every check; everything else may come from the HTTP cache.
const alwaysRevalidated = ['sw.js', 'offline-manifest.js'];

// A page that counts its own loads and registers the real app-updates.js.
const fixturePage = version => `<!doctype html><title>Update fixture</title><p id="version">${version}</p>
   <script>sessionStorage.loads=String(Number(sessionStorage.loads||0)+1);</script>
   <script type="module">import {registerAppUpdates} from './app-updates.js';window.registration=await registerAppUpdates();</script>`;

// A real two-release host: browser route mocks do not intercept worker fetches. release(next, incomplete) publishes
// another version; an incomplete one fails its shell file, as a partly uploaded release would.
export async function startUpdateServer(scope) {
  let version = 1;
  let isIncomplete = false;
  let failures = 0;
  const offlineManifest = () => {
    const workerManifest = {
      shellCache: `kompas-shell-update-test-${version}`,
      shell: ['index.html', 'app-updates.js', 'version.txt']
    };
    return `self.KOMPAS_OFFLINE=${JSON.stringify(workerManifest)};`;
  };
  const server = http.createServer((request, response) => {
    const name = new URL(request.url, 'http://localhost').pathname.slice(scope.length);
    response.setHeader('Content-Type', contentTypes[name] ?? 'text/html');
    response.setHeader('Cache-Control', alwaysRevalidated.includes(name) ? 'no-cache' : 'public, max-age=3600');
    if (name === 'sw.js' || name === 'app-updates.js') return response.end(builtFile(name));
    if (name === 'offline-manifest.js') return response.end(offlineManifest());
    if (name === 'version.txt') {
      if (!isIncomplete) return response.end(String(version));
      failures++;
      response.statusCode = 503;
      return response.end('Incomplete release');
    }
    response.end(fixturePage(version));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}${scope}`,
    release: (next, incomplete = false) => {
      version = next;
      isIncomplete = incomplete;
    },
    get failures() {
      return failures;
    },
    close: () =>
      new Promise(resolve => {
        server.close(resolve);
        server.closeAllConnections();
      })
  };
}
