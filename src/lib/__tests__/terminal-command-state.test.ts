import { afterEach, describe, expect, it } from 'vitest';
import {
  applyOsc633CommandEvent,
  clearTerminalCommandState,
  isCommandRunning,
  parseOsc633CommandEvent,
} from '../terminal-command-state';

afterEach(() => {
  clearTerminalCommandState('connection-a');
  clearTerminalCommandState('connection-b');
});

describe('parseOsc633CommandEvent', () => {
  it('parses command-started (C)', () => {
    expect(parseOsc633CommandEvent('C')).toBe('started');
  });

  it('parses command-finished (D) with or without an exit code', () => {
    expect(parseOsc633CommandEvent('D')).toBe('finished');
    expect(parseOsc633CommandEvent('D;0')).toBe('finished');
    expect(parseOsc633CommandEvent('D;1')).toBe('finished');
  });

  it('treats prompt-start (A) as command-finished', () => {
    expect(parseOsc633CommandEvent('A')).toBe('finished');
  });

  it('ignores cwd reports, other OSC 633 codes, and garbage', () => {
    expect(parseOsc633CommandEvent('P;Cwd=/tmp')).toBeNull();
    expect(parseOsc633CommandEvent('B')).toBeNull();
    expect(parseOsc633CommandEvent('E;echo hello')).toBeNull();
    expect(parseOsc633CommandEvent('')).toBeNull();
    expect(parseOsc633CommandEvent('Cx')).toBeNull();
    expect(parseOsc633CommandEvent('D;')).toBeNull();
  });
});

describe('terminal command state store', () => {
  it('starts unknown so isCommandRunning is false', () => {
    expect(isCommandRunning('connection-a')).toBe(false);
  });

  it('is running only after started, and idle after finished or prompt-start', () => {
    applyOsc633CommandEvent('connection-a', 'C');
    expect(isCommandRunning('connection-a')).toBe(true);

    applyOsc633CommandEvent('connection-a', 'D;0');
    expect(isCommandRunning('connection-a')).toBe(false);

    applyOsc633CommandEvent('connection-a', 'C');
    expect(isCommandRunning('connection-a')).toBe(true);

    applyOsc633CommandEvent('connection-a', 'A');
    expect(isCommandRunning('connection-a')).toBe(false);
  });

  it('keeps command state isolated by connection', () => {
    applyOsc633CommandEvent('connection-a', 'C');
    applyOsc633CommandEvent('connection-b', 'D');

    expect(isCommandRunning('connection-a')).toBe(true);
    expect(isCommandRunning('connection-b')).toBe(false);
  });

  it('clearTerminalCommandState returns the connection to unknown', () => {
    applyOsc633CommandEvent('connection-a', 'C');
    clearTerminalCommandState('connection-a');
    expect(isCommandRunning('connection-a')).toBe(false);
  });

  it('ignores empty connection ids and unrecognized payloads', () => {
    applyOsc633CommandEvent('', 'C');
    applyOsc633CommandEvent('connection-a', 'P;Cwd=/tmp');
    expect(isCommandRunning('')).toBe(false);
    expect(isCommandRunning('connection-a')).toBe(false);
  });
});
