import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // these tests mutate shared account state
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        /*
         * Honour a browser binary supplied by the environment.
         *
         * Playwright resolves browsers by a build number tied to its own version,
         * so a pre-provisioned browser that does not match the installed
         * @playwright/test is ignored and reported as "please run playwright
         * install". Setting CHROMIUM_PATH sidesteps that; unset, Playwright uses
         * its own managed download as normal (which is what CI does).
         */
        launchOptions: process.env.CHROMIUM_PATH
          ? { executablePath: process.env.CHROMIUM_PATH }
          : {},
      },
    },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      APP_ORIGIN: baseURL,
    },
  },
});
