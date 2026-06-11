import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CONFIG_RELATIVE_PATH, loadConfig } from '../src/config.js';
import { writeScaffold } from '../src/scaffold.js';

describe('writeScaffold', () => {
  it('creates a parseable config file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rp-init-'));
    const result = writeScaffold(dir);
    expect(result.created).toBe(true);
    expect(existsSync(join(dir, CONFIG_RELATIVE_PATH))).toBe(true);
    // The scaffold must round-trip through the loader.
    expect(loadConfig(dir).clientNames).toContain('client');
  });

  it('does not overwrite without force', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rp-init-'));
    writeScaffold(dir);
    const path = join(dir, CONFIG_RELATIVE_PATH);
    const original = readFileSync(path, 'utf8');
    const result = writeScaffold(dir);
    expect(result.created).toBe(false);
    expect(readFileSync(path, 'utf8')).toBe(original);
  });

  it('overwrites with force', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rp-init-'));
    writeScaffold(dir);
    expect(writeScaffold(dir, true).created).toBe(true);
  });
});
