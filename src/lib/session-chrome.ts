import type { TerminalTab } from './terminal-group-types';

/** Secondary line shown in the titlebar when each pane keeps its own tab strip. */
export function sessionSubtitle(tab: Pick<
  TerminalTab,
  'tabType' | 'protocol' | 'host' | 'username' | 'editorFilePath' | 'name'
>): string {
  if (tab.tabType === 'editor') {
    return tab.editorFilePath || tab.name;
  }
  const who = [tab.username, tab.host].filter(Boolean).join('@');
  const protocol = tab.protocol || (tab.tabType === 'file-browser' ? 'SFTP' : 'SSH');
  if (tab.protocol === 'Local') return protocol;
  return who ? `${who} · ${protocol}` : protocol;
}

/** Hover text for a titlebar or pane tab: name, endpoint, protocol, and status. */
export function tabTooltip(tab: Pick<TerminalTab, 'host' | 'username' | 'protocol'>, displayName: string, statusLabel: string): string {
  const where = [tab.username, tab.host].filter(Boolean).join('@');
  return [displayName, where, tab.protocol, statusLabel].filter(Boolean).join(' · ');
}
