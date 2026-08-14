export type Osc633CommandEvent = 'started' | 'finished';

/** Parse VS Code-compatible OSC 633 command-lifecycle payloads. */
export function parseOsc633CommandEvent(payload: string): Osc633CommandEvent | null {
  if (payload === 'C') return 'started';
  if (payload === 'A' || payload === 'D') return 'finished';
  if (payload.startsWith('D;') && payload.length > 2 && !payload.includes(';', 2)) {
    return 'finished';
  }
  return null;
}

type CommandState = 'running' | 'idle';

const stateByConnection = new Map<string, CommandState>();

export function applyOsc633CommandEvent(connectionId: string, payload: string): void {
  if (!connectionId) return;
  const event = parseOsc633CommandEvent(payload);
  if (!event) return;
  stateByConnection.set(connectionId, event === 'started' ? 'running' : 'idle');
}

export function isCommandRunning(connectionId: string): boolean {
  return stateByConnection.get(connectionId) === 'running';
}

export function clearTerminalCommandState(connectionId: string): void {
  stateByConnection.delete(connectionId);
}
