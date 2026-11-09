import fs from 'node:fs';
import path from 'node:path';
import type { Config, LogEntry } from '../types';

export function logActivity(config: Config, message: string): LogEntry {
  const entry: LogEntry = { timestamp: new Date().toISOString(), message };
  fs.mkdirSync(config.logsDir, { recursive: true });
  fs.appendFileSync(path.join(config.logsDir, 'activity.log'), `[${entry.timestamp}] ${message}\n`);
  return entry;
}
