import type { TerminalGroup } from './terminal-group-types';

export type MainWindowCloseAction =
  | { type: 'close-tab'; groupId: string; tabId: string }
  | { type: 'quit-app' };

/**
 * Resolve the context-sensitive macOS Close command for the main window.
 * An active terminal tab is closed first; an already-empty workspace exits.
 */
export function resolveMainWindowCloseAction(
  activeGroup: Pick<TerminalGroup, 'id' | 'activeTabId'> | null,
): MainWindowCloseAction {
  if (activeGroup?.activeTabId) {
    return {
      type: 'close-tab',
      groupId: activeGroup.id,
      tabId: activeGroup.activeTabId,
    };
  }

  return { type: 'quit-app' };
}
