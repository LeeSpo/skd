export type CloseIntent =
  | { type: 'close-tabs'; tabs: Array<{ groupId: string; tabId: string }> }
  | { type: 'quit' };

export type BulkCloseAction = 'others' | 'left' | 'right';

export function tabsRemovedByBulkClose(
  tabs: Array<{ id: string }>,
  action: BulkCloseAction,
  pivotTabId: string,
): string[] {
  const pivotIndex = tabs.findIndex((tab) => tab.id === pivotTabId);
  if (pivotIndex === -1) return [];

  if (action === 'others') {
    return tabs.filter((tab) => tab.id !== pivotTabId).map((tab) => tab.id);
  }
  if (action === 'left') {
    return tabs.slice(0, pivotIndex).map((tab) => tab.id);
  }
  return tabs.slice(pivotIndex + 1).map((tab) => tab.id);
}

export function busySessionIds(
  candidates: Array<{ id: string; tabType?: string; connectionStatus: string }>,
  isRunning: (id: string) => boolean,
): string[] {
  return candidates
    .filter((tab) => (
      tab.connectionStatus === 'connected'
      && tab.tabType !== 'file-browser'
      && tab.tabType !== 'editor'
      && isRunning(tab.id)
    ))
    .map((tab) => tab.id);
}

export function shouldConfirmClose(busyIds: string[]): boolean {
  return busyIds.length > 0;
}
