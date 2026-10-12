import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { connectionDropZone, type ConnectionDropPlacement, type SidebarNodeType } from '@/lib/connection-order';

interface ConnectionDragSource {
  id: string;
  name: string;
  type: SidebarNodeType;
  path?: string;
}

export interface ConnectionDragRow {
  id: string;
  type: SidebarNodeType;
  parentPath: string;
  folderPath?: string;
  element: HTMLElement;
}

interface DropHint {
  id: string;
  placement: ConnectionDropPlacement;
}

interface ConnectionRowDragOptions<T extends ConnectionDragSource> {
  disabled: boolean;
  folderPaths: ReadonlySet<string>;
  onDrop: (source: T, parentPath: string, target: ConnectionDragRow, placement: ConnectionDropPlacement) => void;
}

const DRAG_THRESHOLD_PX = 5;
const SCROLL_EDGE_PX = 24;
const SCROLL_SPEED_PX_PER_SECOND = 360;

function rowAt(container: HTMLElement, x: number, y: number): ConnectionDragRow | null {
  const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-connection-row]');
  if (!element || !container.contains(element)) return null;
  const id = element.dataset.connectionRow;
  const type = element.dataset.rowType;
  if (!id || (type !== 'connection' && type !== 'folder')) return null;
  return {
    id,
    type,
    parentPath: element.dataset.parentPath ?? '',
    folderPath: element.dataset.folderPath || undefined,
    element,
  };
}

function dropHint(source: ConnectionDragSource, parentPath: string, target: ConnectionDragRow | null, y: number, folderPaths: ReadonlySet<string>): DropHint | null {
  if (!target || source.id === target.id) return null;
  if (source.type === 'folder' && source.path && target.folderPath &&
    (target.folderPath === source.path || target.folderPath.startsWith(`${source.path}/`))) return null;
  const rect = target.element.getBoundingClientRect();
  const placement = connectionDropZone({
    dragType: source.type,
    rowType: target.type,
    sameParent: parentPath === target.parentPath,
    targetIsCurrentParent: target.type === 'folder' && target.folderPath === parentPath,
    top: rect.top,
    height: rect.height,
    clientY: y,
  });
  if (placement === 'inside' && source.type === 'folder' && folderPaths.has(`${target.folderPath}/${source.name}`)) return null;
  return placement ? { id: target.id, placement } : null;
}

/** Owns one pointer gesture; cancelling never invokes the storage callback. */
export function useConnectionRowDrag<T extends ConnectionDragSource>({ disabled, folderPaths, onDrop }: ConnectionRowDragOptions<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const suppressClickRef = useRef(false);
  const onDropRef = useRef(onDrop);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hint, setHint] = useState<DropHint | null>(null);

  useEffect(() => { onDropRef.current = onDrop; }, [onDrop]);
  const cancelDrag = useCallback(() => { cancelRef.current?.(); }, []);

  useEffect(() => {
    const resetClick = (event: PointerEvent) => {
      if (event.button === 0 && event.isPrimary) suppressClickRef.current = false;
    };
    document.addEventListener('pointerdown', resetClick, true);
    return () => {
      document.removeEventListener('pointerdown', resetClick, true);
      cancelDrag();
    };
  }, [cancelDrag]);

  useEffect(() => { if (disabled) cancelDrag(); }, [disabled, cancelDrag]);

  const shouldSuppressClick = (event: ReactMouseEvent) => suppressClickRef.current && event.detail > 0;

  const startRowDrag = (event: ReactPointerEvent<HTMLDivElement>, source: T, parentPath = '') => {
    if (disabled || event.button !== 0 || !event.isPrimary || source.path === 'All Connections') return;
    const control = event.target instanceof Element
      ? event.target.closest('button, input, textarea, select, a, [role="button"], [contenteditable="true"]')
      : null;
    if (control && control !== event.currentTarget) return;
    const container = containerRef.current;
    if (!container) return;
    cancelDrag();
    suppressClickRef.current = false;
    const element = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let x = startX;
    let y = startY;
    let dragging = false;
    let captured = false;
    let frame: number | null = null;
    let lastFrame: number | null = null;
    const originalCursor = document.body.style.cursor;
    const originalUserSelect = document.body.style.userSelect;

    const updateHint = () => {
      if (!dragging) return;
      const next = dropHint(source, parentPath, rowAt(container, x, y), y, folderPaths);
      setHint((previous) => previous?.id === next?.id && previous?.placement === next?.placement ? previous : next);
    };

    const scrollSpeed = () => {
      const rect = container.getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return 0;
      const edge = Math.min(SCROLL_EDGE_PX, rect.height / 2);
      if (edge <= 0) return 0;
      if (y < rect.top + edge) return -SCROLL_SPEED_PX_PER_SECOND * (1 - (y - rect.top) / edge);
      if (y > rect.bottom - edge) return SCROLL_SPEED_PX_PER_SECOND * (1 - (rect.bottom - y) / edge);
      return 0;
    };

    const scrollFrame = (time: number) => {
      frame = null;
      const elapsed = lastFrame === null ? 16 : Math.min(32, Math.max(0, time - lastFrame));
      lastFrame = time;
      const before = container.scrollTop;
      container.scrollTop = Math.max(0, Math.min(
        Math.max(0, container.scrollHeight - container.clientHeight),
        before + scrollSpeed() * elapsed / 1000,
      ));
      updateHint();
      if (container.scrollTop !== before) frame = requestAnimationFrame(scrollFrame);
      else lastFrame = null;
    };

    const stop = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', cancel);
      element.removeEventListener('lostpointercapture', onCancel);
      container.removeEventListener('scroll', updateHint);
      if (frame !== null) cancelAnimationFrame(frame);
      if (cancelRef.current === cancel) cancelRef.current = null;
      if (captured && element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
      if (dragging) {
        suppressClickRef.current = true;
        document.body.style.cursor = originalCursor;
        document.body.style.userSelect = originalUserSelect;
      }
      setDraggingId(null);
      setHint(null);
    };
    const cancel = () => { stop(); };
    const onCancel = (ev: PointerEvent) => { if (ev.pointerId === pointerId) cancel(); };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && !ev.isComposing && ev.keyCode !== 229) {
        if (dragging) {
          ev.preventDefault();
          ev.stopPropagation();
        }
        cancel();
      }
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      x = ev.clientX;
      y = ev.clientY;
      if (!dragging) {
        if (Math.abs(x - startX) + Math.abs(y - startY) < DRAG_THRESHOLD_PX) return;
        if (element.setPointerCapture) {
          try {
            element.setPointerCapture(pointerId);
            captured = true;
          } catch {
            cancel();
            return;
          }
        }
        dragging = true;
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
        setDraggingId(source.id);
      }
      ev.preventDefault();
      updateHint();
      if (frame === null && scrollSpeed() !== 0) frame = requestAnimationFrame(scrollFrame);
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const target = dragging ? rowAt(container, ev.clientX, ev.clientY) : null;
      const placement = dragging ? dropHint(source, parentPath, target, ev.clientY, folderPaths)?.placement : null;
      stop();
      if (target && placement) onDropRef.current(source, parentPath, target, placement);
    };

    cancelRef.current = cancel;
    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', cancel);
    element.addEventListener('lostpointercapture', onCancel);
    container.addEventListener('scroll', updateHint);
  };

  return { containerRef, draggingId, dropHint: hint, startRowDrag, cancelDrag, shouldSuppressClick };
}
