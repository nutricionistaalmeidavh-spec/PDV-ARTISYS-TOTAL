import { defineConfig, devices } from 'playwright/test';

export const VIEWPORTS = Object.freeze({
  desktop: { width: 1440, height: 900 },
  compactDesktop: { width: 1366, height: 768 },
  tablet: { width: 1024, height: 768 },
  mobile: { width: 390, height: 844 },
});

export const DEMO_PRESETS = Object.freeze({
  'landscape-16x9': Object.freeze({ name: 'landscape-16x9', width: 1920, height: 1080, captureViewport: Object.freeze({ width: 1920, height: 1080 }) }),
  'square-1x1': Object.freeze({ name: 'square-1x1', width: 1080, height: 1080, captureViewport: Object.freeze({ width: 1080, height: 1080 }) }),
  'reels-9x16': Object.freeze({ name: 'reels-9x16', width: 1080, height: 1920, captureViewport: Object.freeze({ width: 1080, height: 1920 }) }),
});

/** Shared Playwright configuration for consumer-owned test suites. */
export function createQaConfig({
  baseURL,
  testDir = './e2e',
  webServer,
  workers = 1,
  viewport = 'desktop',
  capture = {},
  ...overrides
} = {}) {
  if (!baseURL || !['http:', 'https:', 'file:'].includes(new URL(baseURL).protocol)) {
    throw new TypeError('An HTTP(S) or file baseURL is required');
  }
  const selectedViewport = typeof viewport === 'string' ? VIEWPORTS[viewport] : viewport;
  if (!selectedViewport?.width || !selectedViewport?.height) throw new TypeError('A valid viewport is required');
  const { use, ...rest } = overrides;
  return defineConfig({
    testDir,
    fullyParallel: false,
    forbidOnly: Boolean(process.env.CI),
    retries: 0,
    workers,
    timeout: 45000,
    expect: { timeout: 7000 },
    reporter: [
      ['list'],
      ['html', { open: 'never', outputFolder: 'qa-report' }],
      ['junit', { outputFile: 'qa-results/junit.xml' }],
    ],
    outputDir: 'qa-results',
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: selectedViewport } }],
    webServer,
    ...rest,
    use: {
      baseURL,
      viewport: selectedViewport,
      trace: capture.trace ?? 'retain-on-failure',
      screenshot: capture.screenshot ?? 'on',
      video: capture.video ?? 'on',
      ...use,
    },
  });
}
