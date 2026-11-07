import {defineConfig} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const applicationRoot = fileURLToPath(new URL('.', import.meta.url));
const portTool = fileURLToPath(new URL('../../platform/tools/dev-port.mjs', import.meta.url));
const serverTool = fileURLToPath(new URL('../../platform/tools/serve.py', import.meta.url));
const port = Number(
  process.env.E2E_PORT ??
    execFileSync(process.execPath, [portTool, '--e2e', '--app', 'editor'], {
      cwd: applicationRoot,
      encoding: 'utf8'
    }).trim()
);

// One at a time and software rendering unless asked otherwise. CI sets its own worker count. For a faster local run, see
// docs/runbooks/development.md: E2E_WORKERS=6 E2E_ANGLE=vulkan.
const workers = Number(process.env.E2E_WORKERS ?? 1);
const angleBackend = process.env.E2E_ANGLE ?? 'swiftshader';

// The same artifact must work at the origin root and under a project prefix.
// A PR runs on the phone layout only what depends on it, and the nightly run runs everything: docs/verification/testing.md.
const phoneTests = process.env.E2E_PHONE === 'tagged' ? {grep: /@phone/} : {};

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
    // Blocked here so that each test does not store the whole artifact first. The offline suite allows them.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: ['--use-gl=angle', `--use-angle=${angleBackend}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
    }
  },
  projects: [
    {name: 'root-desktop', use: {baseURL: `http://127.0.0.1:${port}/`, viewport: {width: 1280, height: 800}}},
    {
      name: 'pages-mobile',
      ...phoneTests,
      use: {
        baseURL: `http://127.0.0.1:${port}/cg-map/`,
        viewport: {width: 412, height: 840},
        isMobile: true,
        hasTouch: true
      }
    }
  ],
  webServer: {
    cwd: applicationRoot,
    command: `python3 ${serverTool} --port ${port} --app editor --path-prefix /cg-map/`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false
  }
});
