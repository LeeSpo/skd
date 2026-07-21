import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { GridNode } from '../../lib/terminal-group-types';
import { useTerminalGroups } from '../../lib/terminal-group-context';
import { useTerminalThemeKey } from '../../lib/use-terminal-theme-key';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '../ui/resizable';
import { TerminalGroupView, TerminalTabSurface } from './terminal-group-view';

interface GridRendererProps {
  node: GridNode;
  path: number[];
  renderLeaf?: (groupId: string) => ReactNode;
}

/** Derive a stable React key from a GridNode.
 *
 *  The key must survive tree restructuring so that React can reconcile
 *  existing components instead of unmounting/remounting them (which
 *  would tear down live WebSocket + PTY connections).
 *
 *  Strategy: use the smallest (i.e. oldest) leaf groupId in the subtree.
 *  When a leaf is split into a branch, the original group (which always
 *  has a smaller numeric id than the newly created group) stays in the
 *  subtree, so the key remains the same regardless of split direction.
 */
function getStableKey(node: GridNode): string {
  return `grid-${minLeafGroupId(node)}`;
}

function minLeafGroupId(node: GridNode): string {
  if (node.type === 'leaf') return node.groupId;
  let min = '';
  for (const child of node.children) {
    const id = minLeafGroupId(child);
    if (min === '' || Number(id) < Number(min)) {
      min = id;
    }
  }
  return min;
}

function sizesEqual(a: number[] | undefined, b: number[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((value, index) => Math.abs(value - b[index]) < 0.01);
}

export function GridRenderer({ node, path, renderLeaf }: GridRendererProps) {
  const { dispatch } = useTerminalGroups();
  const frameRef = useRef<number | null>(null);
  const pendingSizesRef = useRef<number[] | null>(null);

  const handleLayout = useCallback(
    (sizes: number[]) => {
      if (node.type === 'branch' && sizesEqual(node.sizes, sizes)) {
        return;
      }

      pendingSizesRef.current = sizes;
      if (frameRef.current !== null) return;

      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        const pendingSizes = pendingSizesRef.current;
        pendingSizesRef.current = null;
        if (pendingSizes) {
          dispatch({ type: 'UPDATE_GRID_SIZES', path, sizes: pendingSizes });
        }
      });
    },
    [dispatch, path, node],
  );

  useEffect(() => () => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
    }
  }, []);

  if (node.type === 'leaf') {
    return renderLeaf ? renderLeaf(node.groupId) : <TerminalGroupView groupId={node.groupId} />;
  }

  const childCount = node.children.length;

  const handleDoubleClick = () => {
    const equalSize = 100 / childCount;
    dispatch({
      type: 'UPDATE_GRID_SIZES',
      path,
      sizes: Array(childCount).fill(equalSize),
    });
  };

  return (
    <ResizablePanelGroup direction={node.direction} onLayout={handleLayout}>
      {node.children.map((child, index) => (
        <GridRendererChild
          key={getStableKey(child)}
          child={child}
          index={index}
          path={path}
          defaultSize={node.sizes[index] ?? 100 / childCount}
          isLast={index === childCount - 1}
          onHandleDoubleClick={handleDoubleClick}
          renderLeaf={renderLeaf}
        />
      ))}
    </ResizablePanelGroup>
  );
}

interface GridRendererChildProps {
  child: GridNode;
  index: number;
  path: number[];
  defaultSize: number;
  isLast: boolean;
  onHandleDoubleClick: () => void;
  renderLeaf?: (groupId: string) => ReactNode;
}

function GridRendererChild({
  child,
  index,
  path,
  defaultSize,
  isLast,
  onHandleDoubleClick,
  renderLeaf,
}: GridRendererChildProps) {
  const childPath = [...path, index];
  // Use the stable key (min leaf groupId) for the panel id so that
  // react-resizable-panels can persist layout across tree restructuring.
  const panelId = `grid-panel-${minLeafGroupId(child)}`;

  return (
    <>
      <ResizablePanel id={panelId} order={index} defaultSize={defaultSize} minSize={10}>
        <GridRenderer node={child} path={childPath} renderLeaf={renderLeaf} />
      </ResizablePanel>
      {!isLast && <ResizableHandle dividerTone="panel" onDoubleClick={onHandleDoubleClick} />}
    </>
  );
}

interface PaneRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function rectMapsEqual(
  current: Record<string, PaneRect>,
  next: Record<string, PaneRect>,
): boolean {
  const currentIds = Object.keys(current);
  const nextIds = Object.keys(next);
  if (currentIds.length !== nextIds.length) return false;

  return nextIds.every((id) => {
    const a = current[id];
    const b = next[id];
    return a !== undefined
      && Math.abs(a.left - b.left) < 0.01
      && Math.abs(a.top - b.top) < 0.01
      && Math.abs(a.width - b.width) < 0.01
      && Math.abs(a.height - b.height) < 0.01;
  });
}

/**
 * Keeps every TerminalGroupView mounted while the resizable grid changes shape.
 *
 * A split replaces a leaf in the layout tree with a branch. Rendering terminals
 * directly inside that tree would re-parent (and therefore unmount) the existing
 * PtyTerminal. The lightweight slots below participate in layout; the stable
 * overlay owns the live terminal instances and only updates their rectangles.
 */
export function StableTerminalGrid() {
  const { state, dispatch } = useTerminalGroups();
  const containerRef = useRef<HTMLDivElement>(null);
  const [paneRects, setPaneRects] = useState<Record<string, PaneRect>>({});
  const [contentRects, setContentRects] = useState<Record<string, PaneRect>>({});
  const themeKey = useTerminalThemeKey();
  const groupIdsKey = Object.keys(state.groups).join('|');

  const measurePanes = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const nextRects: Record<string, PaneRect> = {};
    const slots = container.querySelectorAll<HTMLElement>('[data-terminal-group-slot]');

    for (const slot of slots) {
      const groupId = slot.dataset.terminalGroupSlot;
      if (!groupId) continue;
      const rect = slot.getBoundingClientRect();
      nextRects[groupId] = {
        left: rect.left - containerRect.left,
        top: rect.top - containerRect.top,
        width: rect.width,
        height: rect.height,
      };
    }

    setPaneRects((current) => rectMapsEqual(current, nextRects) ? current : nextRects);
  }, []);

  const measureContentAreas = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const nextRects: Record<string, PaneRect> = {};
    const contentAreas = container.querySelectorAll<HTMLElement>('[data-group-content]');

    for (const contentArea of contentAreas) {
      const groupId = contentArea.dataset.groupContent;
      if (!groupId) continue;
      const rect = contentArea.getBoundingClientRect();
      nextRects[groupId] = {
        left: rect.left - containerRect.left,
        top: rect.top - containerRect.top,
        width: rect.width,
        height: rect.height,
      };
    }

    setContentRects((current) => rectMapsEqual(current, nextRects) ? current : nextRects);
  }, []);

  useLayoutEffect(() => {
    measurePanes();
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(measurePanes);
    observer.observe(container);
    for (const slot of container.querySelectorAll<HTMLElement>('[data-terminal-group-slot]')) {
      observer.observe(slot);
    }

    return () => observer.disconnect();
  }, [measurePanes, state.gridLayout]);

  useLayoutEffect(() => {
    measureContentAreas();
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(measureContentAreas);
    for (const contentArea of container.querySelectorAll<HTMLElement>('[data-group-content]')) {
      observer.observe(contentArea);
    }

    return () => observer.disconnect();
  }, [groupIdsKey, measureContentAreas, paneRects]);

  const renderSlot = useCallback((groupId: string) => (
    <div
      data-terminal-group-slot={groupId}
      className="h-full w-full"
      aria-hidden="true"
    />
  ), []);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <GridRenderer node={state.gridLayout} path={[]} renderLeaf={renderSlot} />
      <div className="pointer-events-none absolute inset-0 z-[1]">
        {Object.values(state.groups).flatMap((group) =>
          group.tabs.map((tab) => {
            const ownerGroupId = state.tabToGroupMap[tab.id] ?? group.id;
            const ownerGroup = state.groups[ownerGroupId];
            const rect = contentRects[ownerGroupId];
            const isVisible = ownerGroup?.activeTabId === tab.id;
            const isActive = state.activeGroupId === ownerGroupId && isVisible;

            return (
              <div
                key={tab.id}
                className="pointer-events-auto absolute top-0 left-0 overflow-hidden"
                style={rect ? {
                  display: isVisible ? 'block' : 'none',
                  transform: `translate(${rect.left}px, ${rect.top}px)`,
                  width: rect.width,
                  height: rect.height,
                } : { visibility: 'hidden' }}
                onMouseDownCapture={() => {
                  if (state.activeGroupId !== ownerGroupId) {
                    dispatch({ type: 'ACTIVATE_GROUP', groupId: ownerGroupId });
                  }
                }}
              >
                <TerminalTabSurface tab={tab} isActive={isActive} themeKey={themeKey} />
              </div>
            );
          }),
        )}
      </div>
      <div className="pointer-events-none absolute inset-0 z-[2]">
        {Object.keys(state.groups).map((groupId) => {
          const rect = paneRects[groupId];
          return (
            <div
              key={groupId}
              className="pointer-events-none absolute top-0 left-0 overflow-hidden"
              style={rect ? {
                transform: `translate(${rect.left}px, ${rect.top}px)`,
                width: rect.width,
                height: rect.height,
              } : { visibility: 'hidden' }}
            >
              <TerminalGroupView groupId={groupId} renderTabContents={false} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
