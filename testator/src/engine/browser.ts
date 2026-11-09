import fs from 'node:fs';
import path from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { Config } from '../types';

/**
 * Playwright browser/session lifecycle: launch, login/logout, save/restore
 * the auth session, and read/drive the sidebar's workspace and screen
 * pickers. Everything here operates on a real, visible browser window —
 * `app.tsx` owns *when* each of these runs (including pausing for the
 * sign-in consent prompt before `login()` is ever called).
 */
export async function launchBrowser(
  config: Config
): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const engines = { chromium, firefox, webkit };
  const engine = engines[config.browser] || chromium;
  const browser = await engine.launch({ headless: config.headless });
  const hasSavedSession = fs.existsSync(config.authStatePath);
  const context = await browser.newContext(hasSavedSession ? { storageState: config.authStatePath } : {});
  const page = await context.newPage();
  await page.goto(config.baseUrl);
  return { browser, context, page };
}

export async function isLoggedIn(page: Page): Promise<boolean> {
  return (await page.locator('.app-shell.active').count()) > 0;
}

export async function getCurrentUsername(page: Page): Promise<string | null> {
  const el = page.locator('#current-user');
  if ((await el.count()) === 0) return null;
  const text = await el.textContent();
  return text ? text.trim() : null;
}

export async function login(page: Page, config: Config): Promise<void> {
  if (!config.auth) return;
  const usernameInput = page.locator('#login-username');
  if ((await usernameInput.count()) === 0) return; // already logged in
  await usernameInput.fill(config.auth.username);
  await page.locator('#login-password').fill(config.auth.password);
  await page.locator('#login-form button[type="submit"]').click();
  await page.waitForSelector('.app-shell.active', { timeout: 30000 }).catch(() => {});
}

export async function saveSession(context: BrowserContext, config: Config): Promise<void> {
  fs.mkdirSync(path.dirname(config.authStatePath), { recursive: true });
  await context.storageState({ path: config.authStatePath });
}

export async function logout(page: Page, config: Config): Promise<void> {
  const logoutBtn = page.locator('#logout-btn');
  if ((await logoutBtn.count()) > 0) {
    await logoutBtn.click();
    await page.waitForTimeout(150);
  }
  if (fs.existsSync(config.authStatePath)) {
    fs.rmSync(config.authStatePath);
  }
}

export async function getWorkspaces(page: Page, config: Config): Promise<{ label: string; workspace: string }[]> {
  return page.locator(config.selectors.workspacePicker).evaluateAll(els =>
    els.map(el => ({
      label: (el.textContent || '').trim(),
      workspace: el.getAttribute('data-workspace') || '',
    }))
  );
}

export async function selectWorkspace(page: Page, workspacePickerSelector: string, workspace: string): Promise<void> {
  await page.locator(`${workspacePickerSelector}[data-workspace="${workspace}"]`).click();
  await page.waitForTimeout(150);
}

export async function getScreens(page: Page, config: Config): Promise<{ label: string; route: string }[]> {
  return page.locator(config.selectors.screenPicker).evaluateAll(els =>
    els.map(el => ({
      label: (el.textContent || '').trim(),
      route: el.getAttribute('data-route') || '',
    }))
  );
}

export async function selectScreen(page: Page, screenPickerSelector: string, route: string): Promise<void> {
  await page.locator(`${screenPickerSelector}[data-route="${route}"]`).click();
  await page.waitForTimeout(150);
}
