import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useTerminalGroups } from '@/lib/terminal-group-context';
import { visiblePaneSessions } from '@/lib/visible-pane-sessions';
import {
  clearTabDrag,
  findContentDropTargetAt,
  setActiveDrag,
  setContentDropHover,
} from '@/lib/tab-drag-state';
import { getZoneFromPosition, isSplitDirection } from './drop-zone-overlay';

function containsPoint(element: HTMLElement, x: number, y: number) {
  const rect = element.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function pageInsertionAt(container: HTMLElement, clientX: number) {
  const elements = Array.from(container.querySelectorAll<HTMLElement>('[data-page-id]'));
  for (let index = 0; index < elements.length; index++) {
    const element = elements[index];
    const rect = element.getBoundingClientRect();
    const before = clientX < rect.left + rect.width / 2;
    if (before || index === elements.length - 1) {
      // The centered 2px marker must stay inside the first and last page edges.
      let markerEdge = before ? rect.left : rect.right;
      if (before && index === 0) markerEdge += 1;
      else if (!before && index === elements.length - 1) markerEdge -= 1;
      return {
        targetPageId: element.dataset.pageId!,
        placement: before ? 'before' as const : 'after' as const,
        left: markerEdge - container.getBoundingClientRect().left + container.scrollLeft,
      };
    }
  }
  return null;
}

/** Page reordering stays in the titlebar; only content-edge drops move a session. */
export function useWorkspaceTabDrag() {
  const { state, dispatch } = useTerminalGroups();
  const tabBarRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const suppressClickRef = useRef(false);
  const [insertionLeft, setInsertionLeft] = useState<number | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  const onPointerDownCapture = useCallback((event: ReactPointerEvent) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    suppressClickRef.current = false;
    const target = event.target;
    const container = tabBarRef.current;
    if (!(target instanceof Element) || !container || target.closest('[data-workspace-drag-exclude]')) return;
    const segment = target.closest<HTMLElement>('[data-page-id]');
    const pageId = segment?.dataset.pageId;
    if (!pageId) return;
    cleanupRef.current?.();

    // Capture runs before the split labels stop bubbling, so either pane can
    // reorder its whole page while still focusing normally on a plain click.
    const page = state.pages?.find((entry) => entry.id === pageId);
    const sessions = visiblePaneSessions({ groups: state.groups, gridLayout: page?.gridLayout ?? state.gridLayout });
    const groupId = target.closest<HTMLElement>('[data-split-pane]')?.dataset.splitPane ?? page?.activeGroupId ?? state.activeGroupId;
    const session = sessions.find((entry) => entry.groupId === groupId) ?? sessions[0];
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const previousUserSelect = document.body.style.userSelect;
    let clientX = startX;
    let clientY = startY;
    let dragging = false;
    let scrollFrame: number | null = null;

    const updatePreview = () => {
      if (containsPoint(container, clientX, clientY)) {
        setContentDropHover(null);
        setInsertionLeft(pageInsertionAt(container, clientX)?.left ?? null);
        return;
      }
      setInsertionLeft(null);
      const content = findContentDropTargetAt(clientX, clientY);
      setContentDropHover(content ? {
        groupId: content.groupId,
        zone: getZoneFromPosition(clientX, clientY, content.element.getBoundingClientRect()),
      } : null);
    };

    const autoScroll = () => {
      scrollFrame = null;
      if (!containsPoint(container, clientX, clientY)) return;
      const rect = container.getBoundingClientRect();
      const edge = Math.min(50, rect.width / 4);
      const delta = clientX < rect.left + edge ? -8 : clientX > rect.right - edge ? 8 : 0;
      const next = Math.max(0, Math.min(container.scrollWidth - container.clientWidth, container.scrollLeft + delta));
      if (!delta || next === container.scrollLeft) return;
      container.scrollLeft = next;
      updatePreview();
      scrollFrame = requestAnimationFrame(autoScroll);
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      clientX = ev.clientX;
      clientY = ev.clientY;
      if (!dragging) {
        if (Math.abs(clientX - startX) + Math.abs(clientY - startY) < 5) return;
        dragging = true;
        suppressClickRef.current = true;
        document.body.style.userSelect = 'none';
        if (session) {
          setActiveDrag({ tabId: session.tab.id, sourceGroupId: session.groupId, tabName: session.tab.name });
        }
      }
      ev.preventDefault();
      updatePreview();
      if (scrollFrame === null) scrollFrame = requestAnimationFrame(autoScroll);
    };

    const cleanup = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onCancel);
      container.removeEventListener('scroll', onScroll);
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
      if (dragging) {
        document.body.style.userSelect = previousUserSelect;
        clearTabDrag();
      }
      setInsertionLeft(null);
      cleanupRef.current = null;
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      // Resolve from the release coordinates, never a stale hover or a cancel.
      const shouldDrop = dragging;
      cleanup();
      if (!shouldDrop) return;
      if (containsPoint(container, ev.clientX, ev.clientY)) {
        const insertion = pageInsertionAt(container, ev.clientX);
        if (insertion) {
          dispatch({ type: 'REORDER_PAGE', pageId, targetPageId: insertion.targetPageId, placement: insertion.placement });
        }
        return;
      }
      const content = findContentDropTargetAt(ev.clientX, ev.clientY);
      if (!content || !session) return;
      const zone = getZoneFromPosition(ev.clientX, ev.clientY, content.element.getBoundingClientRect());
      if (isSplitDirection(zone)) {
        dispatch({ type: 'MOVE_TAB_TO_NEW_GROUP', groupId: session.groupId, tabId: session.tab.id, direction: zone, targetGroupId: content.groupId });
      }
    };
    const onCancel = (ev: PointerEvent | Event) => {
      if ('pointerId' in ev && ev.pointerId !== pointerId) return;
      cleanup();
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        cleanup();
      }
    };
    const onScroll = () => {
      if (dragging) updatePreview();
    };

    cleanupRef.current = cleanup;
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onCancel);
    container.addEventListener('scroll', onScroll);
  }, [dispatch, state]);

  const onClickCapture = useCallback((event: MouseEvent) => {
    if (suppressClickRef.current && event.detail !== 0) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, []);

  return { tabBarRef, insertionLeft, onPointerDownCapture, onClickCapture };
}
