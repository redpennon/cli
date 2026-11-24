import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { writeFileNoFollow } from '../src/safe-write.js';
import { writeScaffold } from '../src/scaffold.js';

describe('writeFileNoFollow (SAST #30)', () => {
  it('writes a new file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rp-sw-'));
    writeFileNoFollow(join(dir, 'out.json'), 'hello');
    expect(readFileSync(join(dir, 'out.json'), 'utf8')).toBe('hello');
  });

  it('overwrites a regular file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rp-sw-'));
    writeFileSync(join(dir, 'out.json'), 'old old old');
    writeFileNoFollow(join(dir, 'out.json'), 'new');
    expect(readFileSync(join(dir, 'out.json'), 'utf8')).toBe('new');
  });

  it('refuses to write through a symlink and leaves the target alone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rp-sw-'));
    const target = join(dir, 'target.txt');
    writeFileSync(target, 'precious');
    symlinkSync(target, join(dir, 'usages.json'));
    expect(() => writeFileNoFollow(join(dir, 'usages.json'), 'x')).toThrow(/symlink/i);
    expect(readFileSync(target, 'utf8')).toBe('precious');
  });

  it('refuses a dangling symlink too', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rp-sw-'));
    symlinkSync(join(dir, 'missing'), join(dir, 'usages.json'));
    expect(() => writeFileNoFollow(join(dir, 'usages.json'), 'x')).toThrow(/symlink/i);
  });
});

describe('writeScaffold symlinks (SAST #30)', () => {
  it('does not write through a symlinked config file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rp-sw-'));
    const target = join(dir, 'target.txt');
    writeFileSync(target, 'precious');
    mkdirSync(join(dir, '.redpennon'));
    symlinkSync(target, join(dir, '.redpennon', 'config.yml'));
    expect(() => writeScaffold(dir, true)).toThrow(/symlink/i);
    expect(readFileSync(target, 'utf8')).toBe('precious');
  });

  it('does not create the config through a symlinked .redpennon directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rp-sw-'));
    const elsewhere = mkdtempSync(join(tmpdir(), 'rp-elsewhere-'));
    symlinkSync(elsewhere, join(dir, '.redpennon'));
    expect(() => writeScaffold(dir)).toThrow(/symlink|outside/i);
  });
});
