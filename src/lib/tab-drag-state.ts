import type { SplitDirection } from './terminal-group-types';

/** Active tab drag payload shared across GroupTabBar instances and overlays. */
export interface ActiveDrag {
  tabId: string;
  sourceGroupId: string;
  tabName: string;
}

export type DropZone = SplitDirection | 'center';

/** Content-area drop hover (edge split or center merge). */
export interface ContentDropHover {
  groupId: string;
  zone: DropZone;
}

let activeDrag: ActiveDrag | null = null;
let contentDropHover: ContentDropHover | null = null;

const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export function subscribeTabDrag(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getActiveDrag(): ActiveDrag | null {
  return activeDrag;
}

export function setActiveDrag(drag: ActiveDrag | null): void {
  activeDrag = drag;
  if (!drag) {
    contentDropHover = null;
  }
  notify();
}

export function getContentDropHover(): ContentDropHover | null {
  return contentDropHover;
}

export function setContentDropHover(hover: ContentDropHover | null): void {
  const prev = contentDropHover;
  if (
    prev?.groupId === hover?.groupId &&
    prev?.zone === hover?.zone &&
    (prev === null) === (hover === null)
  ) {
    return;
  }
  contentDropHover = hover;
  notify();
}

export function clearTabDrag(): void {
  activeDrag = null;
  contentDropHover = null;
  notify();
}

// ── Drop target registries ──

const tabBarRegistry = new Map<string, HTMLElement>();
const contentRegistry = new Map<string, HTMLElement>();

export function registerTabBarDropTarget(groupId: string, element: HTMLElement): void {
  tabBarRegistry.set(groupId, element);
}

export function unregisterTabBarDropTarget(groupId: string): void {
  tabBarRegistry.delete(groupId);
}

export function registerContentDropTarget(groupId: string, element: HTMLElement): void {
  contentRegistry.set(groupId, element);
}

export function unregisterContentDropTarget(groupId: string): void {
  contentRegistry.delete(groupId);
}

function elementsFromPointSafe(x: number, y: number): Element[] {
  if (typeof document.elementsFromPoint === 'function') {
    return document.elementsFromPoint(x, y);
  }
  return [];
}

export function findTabBarDropTargetAt(
  x: number,
  y: number,
): { groupId: string; element: HTMLElement } | null {
  // Prefer registry rect hit-test (works when elementsFromPoint is unavailable).
  for (const [groupId, element] of tabBarRegistry) {
    const rect = element.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      return { groupId, element };
    }
  }

  for (const el of elementsFromPointSafe(x, y)) {
    if (el instanceof HTMLElement && el.hasAttribute('data-tab-bar-group')) {
      const gid = el.getAttribute('data-tab-bar-group');
      if (gid) return { groupId: gid, element: el };
    }
  }
  return null;
}

export function findContentDropTargetAt(
  x: number,
  y: number,
): { groupId: string; element: HTMLElement } | null {
  // Prefer registry rect hit-test so pointer-events-none overlays do not block.
  for (const [groupId, element] of contentRegistry) {
    const rect = element.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      return { groupId, element };
    }
  }

  // Fallback via DOM attributes
  for (const el of elementsFromPointSafe(x, y)) {
    if (el instanceof HTMLElement && el.hasAttribute('data-group-content')) {
      const gid = el.getAttribute('data-group-content');
      if (gid) return { groupId: gid, element: el };
    }
  }
  return null;
}

export function calcTabInsertionIndex(container: HTMLElement, clientX: number): number {
  const tabElements = Array.from(container.querySelectorAll('[data-tab-id]'));
  for (let i = 0; i < tabElements.length; i++) {
    const rect = tabElements[i].getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) return i;
  }
  return tabElements.length;
}
