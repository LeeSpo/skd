import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearTerminalCwd,
  decodeOsc633Value,
  parseOsc1337Cwd,
  parseOsc633Cwd,
  parseOsc7Cwd,
  publishTerminalCwd,
  useTerminalCwd,
} from '../terminal-cwd-store';

afterEach(() => {
  clearTerminalCwd('connection-a');
  clearTerminalCwd('connection-b');
  cleanup();
});

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
    expect(parseOsc1337Cwd('CurrentDir=/Users/alice/My Project')).toBe('/Users/alice/My Project');
    expect(parseOsc1337Cwd('CurrentDir=/tmp/100%')).toBe('/tmp/100%');
    expect(parseOsc1337Cwd('SetMark')).toBeNull();
  });

  it('parses VS Code-compatible Cwd property reports', () => {
    expect(parseOsc633Cwd('P;Cwd=/srv/www site')).toBe('/srv/www site');
    expect(parseOsc633Cwd('P;Cwd=/srv/100%/项目')).toBe('/srv/100%/项目');
    expect(parseOsc633Cwd('P;Cwd=/srv/a\\x3bb\\\\c')).toBe('/srv/a;b\\c');
    expect(parseOsc633Cwd('E;echo hello')).toBeNull();
  });

  it('rejects malformed or unsafe OSC 633 escaping', () => {
    expect(decodeOsc633Value('/tmp/unfinished\\')).toBeNull();
    expect(decodeOsc633Value('/tmp/bad\\q')).toBeNull();
    expect(parseOsc633Cwd('P;Cwd=/tmp/line\\x0afeed')).toBeNull();
    expect(parseOsc633Cwd('P;Cwd=relative/path')).toBeNull();
  });

  it('keeps cwd reports isolated by terminal connection', () => {
    function CwdProbe({ connectionId }: { connectionId: string }) {
      return React.createElement(
        'span',
        { 'data-testid': connectionId },
        useTerminalCwd(connectionId) ?? 'unset',
      );
    }

    render(React.createElement(
      React.Fragment,
      null,
      React.createElement(CwdProbe, { connectionId: 'connection-a' }),
      React.createElement(CwdProbe, { connectionId: 'connection-b' }),
    ));
    act(() => {
      publishTerminalCwd('connection-a', '/srv/a');
      publishTerminalCwd('connection-b', '/srv/b');
    });

    expect(screen.getByTestId('connection-a').textContent).toBe('/srv/a');
    expect(screen.getByTestId('connection-b').textContent).toBe('/srv/b');
    act(() => {
      clearTerminalCwd('connection-a');
    });
    expect(screen.getByTestId('connection-a').textContent).toBe('unset');
    expect(screen.getByTestId('connection-b').textContent).toBe('/srv/b');
  });
});
