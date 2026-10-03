import { describe, expect, it } from 'vitest';
import { sessionSubtitle, tabTooltip } from '../session-chrome';
import type { TerminalTab } from '../terminal-group-types';

const base: TerminalTab = {
  id: '1',
  name: 'prod-api',
  connectionStatus: 'connected',
  reconnectCount: 0,
};

describe('session chrome', () => {
  it('describes ssh, local, file and editor sessions', () => {
    expect(sessionSubtitle({ ...base, protocol: 'SSH', username: 'root', host: 'db' })).toBe('root@db · SSH');
    expect(sessionSubtitle({ ...base, protocol: 'Local', name: 'zsh' })).toBe('Local');
    expect(sessionSubtitle({ ...base, tabType: 'file-browser', protocol: 'SFTP', username: 'a', host: 'files' })).toBe('a@files · SFTP');
    expect(sessionSubtitle({ ...base, tabType: 'editor', editorFilePath: '/etc/hosts' })).toBe('/etc/hosts');
  });

  it('includes status in the tab tooltip', () => {
    expect(tabTooltip({ ...base, protocol: 'SSH', username: 'root', host: 'db' }, 'prod-api', 'Connected')).toBe(
      'prod-api · root@db · SSH · Connected',
    );
  });
});