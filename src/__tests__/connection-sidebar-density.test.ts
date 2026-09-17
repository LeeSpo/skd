import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/connection-manager.tsx', 'utf8');

describe('Connections compact density', () => {
  it('uses 28px rows and a 36px header without shrinking connection names', () => {
    expect(source).toContain('h-7 gap-1.5 rounded-sm py-0 pr-2 cursor-pointer');
    expect(source).toContain('className="h-9 shrink-0 gap-0.5 px-2"');
    expect(source).toContain('truncate text-[13px]');
  });

  it('reduces tree indentation and outer whitespace locally', () => {
    expect(source).toContain('style={treeIndent(level, 4, 12)}');
    expect(source).toContain('className="h-5 w-5 shrink-0 rounded-sm p-0"');
    expect(source).toContain('className="h-4 w-5 shrink-0"');
    expect(source).toContain('overflow-auto px-1.5 py-1');
  });

  it('removes duplicate protocol and empty description details', () => {
    expect(source.match(/selectedConnection\.protocol/g)).toHaveLength(2);
    expect(source).not.toContain("t('connectionManager.description')");
    expect(source).toContain('sidebar-connection-details px-2 pb-2');
  });
});
