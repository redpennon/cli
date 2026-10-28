import { describe, expect, it } from 'vitest';

import { buildPatterns, extractArrayKeys } from '../src/patterns.js';
import { extensionOf, scanText, scanTextWithConfig } from '../src/matcher.js';
import { DEFAULT_CONFIG, mergeConfig } from '../src/config.js';

const patterns = buildPatterns(DEFAULT_CONFIG);

function keys(refs: { key: string }[]): string[] {
  return refs.map((r) => r.key).sort();
}

describe('extensionOf', () => {
  it('returns the lowercased extension', () => {
    expect(extensionOf('src/App.TS')).toBe('ts');
    expect(extensionOf('main.go')).toBe('go');
    expect(extensionOf('Makefile')).toBe('');
  });
});

describe('Node / TypeScript matching', () => {
  it('captures client.variable and client.variableValue', () => {
    const text = [
      "const a = client.variable('dark-mode');",
      "const b = client.variableValue('new-checkout', false);",
    ].join('\n');
    expect(keys(scanText(text, 'app.ts', patterns))).toEqual([
      'dark-mode',
      'new-checkout',
    ]);
  });

  it('captures batch variables([...]) as multiple keys', () => {
    const text = "client.variables(['a-flag', \"b-flag\", 'c-flag']);";
    expect(keys(scanText(text, 'app.ts', patterns))).toEqual([
      'a-flag',
      'b-flag',
      'c-flag',
    ]);
  });

  it('records line number and trimmed snippet', () => {
    const text = "line one\n  const x = client.variable('show-banner');\n";
    const [ref] = scanText(text, 'app.tsx', patterns);
    expect(ref.line_number).toBe(2);
    expect(ref.snippet).toBe("const x = client.variable('show-banner');");
    expect(ref.file).toBe('app.tsx');
  });

  it('ignores non-SDK calls and unknown client names', () => {
    const text = "other.variable('nope');\nclient.somethingElse('no');";
    expect(scanText(text, 'app.js', patterns)).toEqual([]);
  });
});

describe('Go matching', () => {
  it('captures the second argument of Variable / VariableValue', () => {
    const text = [
      'v := client.Variable(ctx, "dark-mode", false)',
      'x := client.VariableValue(ctx, "new-checkout", true)',
    ].join('\n');
    expect(keys(scanText(text, 'main.go', patterns))).toEqual([
      'dark-mode',
      'new-checkout',
    ]);
  });

  it('does not apply Node patterns to .go files', () => {
    const text = "client.variable('lower-case-go')";
    expect(scanText(text, 'main.go', patterns)).toEqual([]);
  });
});

describe('Python matching', () => {
  it('captures variable and variable_value', () => {
    const text = [
      "a = client.variable('dark-mode')",
      "b = client.variable_value('new-checkout')",
    ].join('\n');
    expect(keys(scanText(text, 'app.py', patterns))).toEqual([
      'dark-mode',
      'new-checkout',
    ]);
  });

  it('captures batch variables([...])', () => {
    const text = "client.variables(['x-flag', 'y-flag'])";
    expect(keys(scanText(text, 'app.py', patterns))).toEqual(['x-flag', 'y-flag']);
  });
});

describe('extractArrayKeys', () => {
  it('extracts quoted keys across whitespace and newlines', () => {
    expect(extractArrayKeys("'a',\n  \"b\" , 'c'")).toEqual(['a', 'b', 'c']);
  });
});

describe('de-duplication', () => {
  it('collapses identical key + line occurrences', () => {
    const text = "client.variable('dup'); client.variable('dup');";
    const refs = scanText(text, 'app.ts', patterns);
    expect(refs).toHaveLength(1);
  });

  it('keeps the same key on different lines', () => {
    const text = "client.variable('dup');\nclient.variable('dup');";
    const refs = scanText(text, 'app.ts', patterns);
    expect(refs).toHaveLength(2);
  });
});

describe('config-driven matching', () => {
  it('honours custom client names', () => {
    const config = mergeConfig(DEFAULT_CONFIG, { clientNames: ['rpClient'] });
    const text = "rpClient.variable('dark-mode');";
    expect(keys(scanTextWithConfig(text, 'app.ts', config))).toEqual(['dark-mode']);
  });

  it('applies variable aliases', () => {
    const config = mergeConfig(DEFAULT_CONFIG, {
      variableAliases: { 'FLAGS.DARK': 'dark-mode' },
      matchPatterns: { ts: ['getFlag\\(\\s*[\'"]([\\w.]+)[\'"]'] },
    });
    const text = "getFlag('FLAGS.DARK')";
    expect(keys(scanTextWithConfig(text, 'app.ts', config))).toEqual(['dark-mode']);
  });

  it('applies custom match patterns per extension', () => {
    const config = mergeConfig(DEFAULT_CONFIG, {
      matchPatterns: { ts: ['toggle\\(\\s*[\'"]([\\w-]+)[\'"]'] },
    });
    const text = "toggle('experimental')";
    expect(keys(scanTextWithConfig(text, 'app.ts', config))).toEqual([
      'experimental',
    ]);
  });
});

describe('snippet sanitisation', () => {
  it('truncates long snippets to 200 characters', () => {
    const pad = 'x'.repeat(400);
    const text = `const pad = '${pad}'; client.variable('dark-mode');`;
    const [ref] = scanText(text, 'app.ts', patterns);
    expect(ref.snippet.length).toBeLessThanOrEqual(200);
  });

  it('keeps the matched call visible when truncating a long line', () => {
    const text = `${'y'.repeat(500)} client.variable('dark-mode')`;
    const [ref] = scanText(text, 'app.ts', patterns);
    expect(ref.snippet).toContain("client.variable('dark-mode')");
  });

  it.each([
    ['rpa token', "client.variable('a'); const t = 'rpa_abcdef1234567890abcdef';", 'rpa_abcdef1234567890abcdef'],
    ['aws access key', "client.variable('a'); // AKIAIOSFODNN7EXAMPLE", 'AKIAIOSFODNN7EXAMPLE'],
    ['bearer token', "client.variable('a'); h = 'Bearer abc.def-123_xyz'", 'abc.def-123_xyz'],
    ['password assignment', "client.variable('a'); password = 'hunter2hunter2'", 'hunter2hunter2'],
    ['token assignment', "client.variable('a'); api_token: sup3rs3cret", 'sup3rs3cret'],
  ])('redacts %s', (_label, line, secret) => {
    const [ref] = scanText(line, 'app.ts', patterns);
    expect(ref.snippet).not.toContain(secret);
    expect(ref.snippet).toContain('[REDACTED]');
    expect(ref.key).toBe('a');
  });

  it('leaves ordinary snippets untouched', () => {
    const [ref] = scanText("  const a = client.variable('dark-mode');", 'app.ts', patterns);
    expect(ref.snippet).toBe("const a = client.variable('dark-mode');");
  });
});

describe('line numbers', () => {
  it('reports correct lines in a large file', () => {
    const lines = Array.from({ length: 20000 }, (_, i) => `// filler ${i}`);
    lines[0] = "client.variable('first')";
    lines[12344] = "client.variable('middle')";
    lines[19999] = "client.variable('last')";
    const refs = scanText(lines.join('\n'), 'big.ts', patterns);
    const byKey = Object.fromEntries(refs.map((r) => [r.key, r.line_number]));
    expect(byKey).toEqual({ first: 1, middle: 12345, last: 20000 });
  });
});
