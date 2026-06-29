import { describe, expect, it } from 'vitest';
import { connectionNameUpdateForHostChange } from '../connection-name-sync';

describe('connectionNameUpdateForHostChange', () => {
  it('syncs name from host for new connections when name was not manually edited', () => {
    expect(
      connectionNameUpdateForHostChange('192.168.1.1', {
        isNewConnection: true,
        nameManuallyEdited: false,
      }),
    ).toEqual({ name: '192.168.1.1' });
  });

  it('does not sync when name was manually edited', () => {
    expect(
      connectionNameUpdateForHostChange('192.168.1.2', {
        isNewConnection: true,
        nameManuallyEdited: true,
      }),
    ).toEqual({});
  });

  it('does not sync when editing an existing connection', () => {
    expect(
      connectionNameUpdateForHostChange('prod.example.com', {
        isNewConnection: false,
        nameManuallyEdited: false,
      }),
    ).toEqual({});
  });
});