import { describe, expect, it } from 'vitest';
import { parseOsc1337Cwd, parseOsc633Cwd, parseOsc7Cwd } from '../terminal-cwd-store';

describe('terminal cwd escape-sequence parsing', () => {
  it('parses and decodes an OSC 7 file URI', () => {
    expect(parseOsc7Cwd('file://server/home/alice/My%20Project')).toBe('/home/alice/My Project');
  });

  it('accepts OSC 7 without a hostname', () => {
    expect(parseOsc7Cwd('file:///tmp/build')).toBe('/tmp/build');
  });

  it('rejects unsupported, relative, malformed, and control-character values', () => {
    expect(parseOsc7Cwd('https://server/tmp')).toBeNull();
    expect(parseOsc7Cwd('tmp/build')).toBeNull();
    expect(parseOsc7Cwd('file:///tmp/%E0%A4%A')).toBeNull();
    expect(parseOsc7Cwd('file:///tmp\n/other')).toBeNull();
  });

  it('parses iTerm-compatible CurrentDir reports', () => {
    expect(parseOsc1337Cwd('CurrentDir=/Users/alice/My%20Project')).toBe('/Users/alice/My Project');
    expect(parseOsc1337Cwd('SetMark')).toBeNull();
  });

  it('parses VS Code-compatible Cwd property reports', () => {
    expect(parseOsc633Cwd('P;Cwd=/srv/www%20site')).toBe('/srv/www site');
    expect(parseOsc633Cwd('E;echo hello')).toBeNull();
  });
});
