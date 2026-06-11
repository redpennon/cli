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
