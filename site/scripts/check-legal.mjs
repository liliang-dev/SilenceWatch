#!/usr/bin/env node
/**
 * Fails when a legal page still carries the placeholder from `src/legal.ts`.
 *
 * Run by the workflow that ships the site, and deliberately not by the pull-
 * request checks: the placeholders are meant to exist on `dev` until the
 * publisher's identity is filled in, and meant never to reach silencewatch.com.
 * Scanning the built pages, rather than the source, checks what visitors would
 * actually read.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PLACEHOLDER = 'À COMPLÉTER';

const found = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith('.html') && readFileSync(path, 'utf8').includes(PLACEHOLDER)) {
      found.push(path.slice(dist.length));
    }
  }
};
walk(dist);

if (found.length > 0) {
  console.error(`The publisher's identity is not filled in (src/legal.ts): ${found.length} page(s) still say "${PLACEHOLDER}":`);
  for (const page of found) console.error(`  ${page}`);
  process.exit(1);
}
console.log('Legal pages: the publisher is identified.');
