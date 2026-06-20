import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FIXTURE_REPO } from './fixture.js';

/**
 * End-to-end UX proof (Criteria 4, 5, 6):
 *  - the agent streams tool activity (git_log / git_diff) then tokens,
 *  - the three audience tabs render SHA-cited content,
 *  - the risky "write CHANGELOG.md" action is gated by an explicit confirm
 *    modal, and only writes after the human confirms.
 */
test('streams grounded release notes and human-gates the changelog write', async ({ page }) => {
  await page.goto('/');

  // Running on the keyless offline mock (no Azure required for CI).
  await expect(page.locator('#provider-badge')).toContainText('Offline mock');

  await page.locator('#generate').click();

  // 1) Tool activity is surfaced live.
  await expect(page.locator('#timeline')).toContainText('git_log');
  await expect(page.locator('#timeline')).toContainText('git_diff');

  // 2) The developer changelog streams in, grounded with a real commit SHA.
  const changelog = page.locator('#view-changelog');
  await expect(changelog).toContainText('Added');
  await expect(changelog).toContainText('rename greet to hello');
  await expect(changelog).toContainText(/[0-9a-f]{7}/); // a cited short SHA

  // 3) All three audiences are produced in one pass.
  await page.locator('.tab[data-tab="announcement"]').click();
  await expect(page.locator('#view-announcement')).toBeVisible();
  await expect(page.locator('#view-announcement')).toContainText(/release/i);

  await page.locator('.tab[data-tab="migration"]').click();
  await expect(page.locator('#view-migration')).toBeVisible();
  await expect(page.locator('#view-migration')).toContainText(/breaking/i); // feat! in fixture

  // 4) The write action requires explicit human confirmation (Criterion 6).
  await expect(page.locator('#apply')).toBeEnabled();
  await page.locator('#apply').click();

  const modal = page.locator('#modal');
  await expect(modal).toBeVisible();
  await expect(page.locator('#modal-preview')).not.toBeEmpty();

  // Cancel first: nothing should be written.
  await page.locator('#modal-cancel').click();
  await expect(modal).toBeHidden();

  // Now confirm: the file is written and a success toast appears.
  await page.locator('#apply').click();
  await expect(modal).toBeVisible();
  await page.locator('#modal-confirm').click();
  await expect(modal).toBeHidden();

  const toast = page.locator('#toast');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('CHANGELOG.md');

  // 5) The write landed in the disposable fixture repo (not the project).
  const written = readFileSync(path.join(FIXTURE_REPO, 'CHANGELOG.md'), 'utf8');
  expect(written).toContain('rename greet to hello');
});
