import {defineConfig} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {pinnedContractsRoot} from './tests/pinned-contracts.mjs';
import {pinnedDataRoot} from './tests/pinned-data.mjs';

// The browser suite's build reads data and contracts through these roots unless a caller already chose one.
process.env.MAP_DATA_ROOT ??= pinnedDataRoot;
process.env.MAP_CONTRACTS_ROOT ??= pinnedContractsRoot;
const webRoot = fileURLToPath(new URL('.', import.meta.url));
const portTool = fileURLToPath(new URL('../../platform/tools/dev-port.mjs', import.meta.url));
const serverTool = fileURLToPath(new URL('../../platform/tools/serve.py', import.meta.url));
const port = Number(
  process.env.E2E_PORT ??
    execFileSync(process.execPath, [portTool, '--e2e'], {
      cwd: webRoot,
      encoding: 'utf8'
    }).trim()
);
// One at a time and software rendering unless asked otherwise. CI sets its own worker count. For a faster local run, see
// docs/runbooks/development.md: E2E_WORKERS=6 E2E_ANGLE=vulkan.
const workers = Number(process.env.E2E_WORKERS ?? 1);
const angleBackend = process.env.E2E_ANGLE ?? 'swiftshader';

// Only tagged tests run on the phone layout, in PRs and nightly alike: docs/verification/testing.md.
// @desktop and @phone-only tests choose their project here, so their bodies no longer skip after setup and page load.
const desktopFilter = {grepInvert: /@mobile-only|@phone-only/};
const phoneFilter = {grep: /@phone/, grepInvert: /@desktop/};

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90000,
  expect: {timeout: 15000},
  workers,
  fullyParallel: workers > 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    browserName: 'chromium',
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: [
        '--use-gl=angle',
        `--use-angle=${angleBackend}`,
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist'
      ]
    }
  },
  projects: [
    // @desktop, @mobile-only and @phone-only tests run in one project. The phone-only ones also carry @phone for a PR.
    {
      name: 'root-desktop',
      ...desktopFilter,
      use: {baseURL: `http://127.0.0.1:${port}/`, viewport: {width: 1280, height: 800}}
    },
    {
      name: 'pages-mobile',
      ...phoneFilter,
      use: {
        baseURL: `http://127.0.0.1:${port}/cg-map/`,
        viewport: {width: 412, height: 840},
        isMobile: true,
        hasTouch: true
      }
    }
  ],
  webServer: {
    cwd: webRoot,
    command: `python3 ${serverTool} --port ${port} --path-prefix /cg-map/`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false
  }
});
