import type { SplitDirection } from '../../lib/terminal-group-types';
import type { DropZone } from '../../lib/tab-drag-state';

export type { DropZone };

interface DropZoneOverlayProps {
  groupId: string;
  visible: boolean;
  /** Controlled highlight zone from pointer drag hit-testing */
  activeZone: DropZone | null;
}

const EDGE_THRESHOLD = 0.25;

export function getZoneFromPosition(
  clientX: number,
  clientY: number,
  rect: DOMRect,
): DropZone {
  const relX = (clientX - rect.left) / rect.width;
  const relY = (clientY - rect.top) / rect.height;

  if (relY < EDGE_THRESHOLD) return 'up';
  if (relY > 1 - EDGE_THRESHOLD) return 'down';
  if (relX < EDGE_THRESHOLD) return 'left';
  if (relX > 1 - EDGE_THRESHOLD) return 'right';
  return 'center';
}

/**
 * Visual preview of the *result* of a drop, not the edge trigger strip.
 * Edge hits still use EDGE_THRESHOLD (25%) in getZoneFromPosition; the
 * overlay shows the half-pane (50%) that insertSplit will create, matching
 * VS Code-style dock previews.
 */
export function DropZoneOverlay({ groupId, visible, activeZone }: DropZoneOverlayProps) {
  if (!visible) return null;

  return (
    <div
      data-testid={`drop-zone-overlay-${groupId}`}
      className="absolute inset-0 z-50 pointer-events-none"
      aria-hidden
    >
      {activeZone === 'up' && (
        <div data-testid="drop-zone-up" className="absolute inset-x-0 top-0 h-1/2 bg-drop-zone ring-1 ring-inset ring-primary/50" />
      )}
      {activeZone === 'down' && (
        <div data-testid="drop-zone-down" className="absolute inset-x-0 bottom-0 h-1/2 bg-drop-zone ring-1 ring-inset ring-primary/50" />
      )}
      {activeZone === 'left' && (
        <div data-testid="drop-zone-left" className="absolute inset-y-0 left-0 w-1/2 bg-drop-zone ring-1 ring-inset ring-primary/50" />
      )}
      {activeZone === 'right' && (
        <div data-testid="drop-zone-right" className="absolute inset-y-0 right-0 w-1/2 bg-drop-zone ring-1 ring-inset ring-primary/50" />
      )}
      {activeZone === 'center' && (
        <div data-testid="drop-zone-center" className="absolute inset-0 bg-drop-zone ring-1 ring-inset ring-primary/50" />
      )}
    </div>
  );
}

/** Type guard helper for edge-only zones (excludes center). */
export function isSplitDirection(zone: DropZone): zone is SplitDirection {
  return zone === 'up' || zone === 'down' || zone === 'left' || zone === 'right';
}
