import fs from 'node:fs';
import path from 'node:path';
import type { Config, LogEntry } from '../types';

/**
 * Append-only, free-text session log, persisted across every run.
 *
 * This is a flat narration of "what happened" (logins, scans, saves,
 * replays) for the header's "Last: ..." line and `logs/activity.log` —
 * unrelated to the structured per-element event log in `exploration.ts`
 * that the saved report's navigation timeline is built from.
 */
export function logActivity(config: Config, message: string): LogEntry {
  const entry: LogEntry = { timestamp: new Date().toISOString(), message };
  fs.mkdirSync(config.logsDir, { recursive: true });
  fs.appendFileSync(path.join(config.logsDir, 'activity.log'), `[${entry.timestamp}] ${message}\n`);
  return entry;
}
