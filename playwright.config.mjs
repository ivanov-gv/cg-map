import {defineConfig} from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 8095);
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90000,
  expect: {timeout: 15000},
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    browserName: 'chromium',
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']}
  },
  projects: [
    {name: 'root-desktop', use: {baseURL: `http://127.0.0.1:${port}/`, viewport: {width: 1280, height: 800}}},
    {name: 'pages-mobile', use: {baseURL: `http://127.0.0.1:${port}/cg-map/`, viewport: {width: 412, height: 840}, isMobile: true, hasTouch: true}}
  ],
  webServer: {
    command: `python3 tests/e2e/serve.py --port ${port}`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false
  }
});
