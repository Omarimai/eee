import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from './types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const DEFAULT_SELECTORS = {
  workspacePicker: '.workspace-tab',
  screenPicker: '.sidebar-nav .nav-link',
  contentRegion: '#route-content',
};

export function loadConfig(): Config {
  const configPath = path.join(ROOT, 'config.json');
  const raw = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};

  return {
    baseUrl: raw.baseUrl || '',
    environment: raw.environment || 'development',
    browser: raw.browser || 'chromium',
    headless: raw.headless ?? false,
    auth: raw.auth ?? null,
    reportsDir: path.resolve(ROOT, raw.reportsDir || './reports'),
    historyDir: path.resolve(ROOT, raw.historyDir || './history'),
    scenariosDir: path.resolve(ROOT, raw.scenariosDir || './scenarios'),
    logsDir: path.resolve(ROOT, raw.logsDir || './logs'),
    authStatePath: path.resolve(ROOT, raw.authStatePath || './.auth/state.json'),
    selectors: { ...DEFAULT_SELECTORS, ...(raw.selectors || {}) },
    ai: { enabled: raw.ai?.enabled ?? false },
  };
}
