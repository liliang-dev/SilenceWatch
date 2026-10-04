#!/usr/bin/env node
/**
 * Records one availability probe and rewrites the uptime badge.
 *
 * Usage: node scripts/uptime.mjs <directory> <up|down>
 *
 * The directory holds `history.txt` — one character per probe, `1` up and `0`
 * down, the last 30 days of them at one probe every five minutes — and
 * `badge.json`, in the format of shields.io's endpoint badge. Run by
 * .github/workflows/uptime.yml, which keeps both on the `uptime` branch.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WINDOW = 30 * 24 * 12;

const [directory, result] = process.argv.slice(2);
if (directory === undefined || (result !== 'up' && result !== 'down')) {
  process.stderr.write('usage: uptime.mjs <directory> <up|down>\n');
  process.exit(2);
}

const historyFile = join(directory, 'history.txt');
const previous = existsSync(historyFile) ? readFileSync(historyFile, 'utf8').replace(/[^01]/g, '') : '';
const history = (previous + (result === 'up' ? '1' : '0')).slice(-WINDOW);
const ratio = (history.split('1').length - 1) / history.length;

const percent = ratio === 1 ? '100%' : `${Math.floor(ratio * 10_000) / 100}%`;
const colour = result === 'down' ? 'red' : ratio >= 0.999 ? 'brightgreen' : ratio >= 0.99 ? 'green' : ratio >= 0.95 ? 'yellow' : 'orange';

writeFileSync(historyFile, `${history}\n`);
writeFileSync(
  join(directory, 'badge.json'),
  `${JSON.stringify({
    schemaVersion: 1,
    label: 'uptime (30 d)',
    message: result === 'down' ? `${percent}, down now` : percent,
    color: colour,
  })}\n`,
);
