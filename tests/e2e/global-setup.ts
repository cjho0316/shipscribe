import { createFixtureRepo } from './fixture.js';

/** Runs once before the Playwright webServer boots. */
export default function globalSetup(): void {
  createFixtureRepo();
}
