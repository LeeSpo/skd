import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionManager } from '@/components/connection-manager';
import { ConnectionStorageManager, type ConnectionTreeNode } from '@/lib/connection-storage';

const tree: ConnectionTreeNode[] = [
  {
    id: 'root',
    name: 'All Connections',
    type: 'folder' as const,
    path: 'All Connections',
    isExpanded: true,
    children: [
      {
        id: 'work',
        name: 'Work',
        type: 'folder' as const,
        path: 'All Connections/Work',
        isExpanded: true,
        children: [
          { id: 'nested', name: 'Nested', type: 'connection' as const, protocol: 'SSH' },
        ],
      },
      {
        id: 'personal',
        name: 'Personal',
        type: 'folder' as const,
        path: 'All Connections/Personal',
        isExpanded: true,
        children: [],
      },
      { id: 'alpha', name: 'Alpha', type: 'connection' as const, protocol: 'SSH', host: 'a.example' },
      { id: 'beta', name: 'Beta', type: 'connection' as const, protocol: 'SSH', host: 'b.example' },
    ],
  },
];

function row(name: string): HTMLElement {
  const label = screen.getByText(name);
  const element = label.closest<HTMLElement>('[data-connection-row]');
  if (!element) throw new Error(`Missing row for ${name}`);
  return element;
}

function setRect(element: HTMLElement, top: number, height: number) {
  element.getBoundingClientRect = () => ({
    x: 0,
    y: top,
    top,
    left: 0,
    right: 200,
    bottom: top + height,
    width: 200,
    height,
    toJSON() { return {}; },
  });
}

function drag(source: HTMLElement, x: number, y: number) {
  fireEvent.pointerDown(source, { button: 0, isPrimary: true, pointerId: 1, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(document, { pointerId: 1, clientX: 0, clientY: 8 });
  fireEvent.pointerMove(document, { pointerId: 1, clientX: x, clientY: y });
  fireEvent.pointerUp(document, { pointerId: 1, clientX: x, clientY: y });
}

function hitTarget(element: Element) {
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    writable: true,
    value: () => element,
  });
}

describe('ConnectionManager reorder', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (document.body.style as { cursor?: string }).cursor;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    delete (document as { elementFromPoint?: unknown }).elementFromPoint;
  });

  function renderTree(nodes = tree) {
    vi.spyOn(ConnectionStorageManager, 'buildConnectionTree').mockReturnValue(nodes);
    const onConnectionSelect = vi.fn();
    const onConnectionConnect = vi.fn();
    const view = render(<ConnectionManager onConnectionSelect={onConnectionSelect} onConnectionConnect={onConnectionConnect} selectedConnectionId={null} />);
    return { onConnectionSelect, onConnectionConnect, ...view };
  }

  it('drags a connection below another and keeps a collapsed folder collapsed', () => {
    const reorder = vi.spyOn(ConnectionStorageManager, 'reorderConnection').mockReturnValue(true);
    const { onConnectionSelect } = renderTree();
    fireEvent.click(screen.getByRole('button', { name: 'Work', expanded: true }));
    expect(screen.getByRole('button', { name: 'Work', expanded: false })).toBeTruthy();

    const beta = row('Beta');
    setRect(beta, 40, 20);
    hitTarget(beta);
    drag(row('Alpha'), 10, 55);

    expect(reorder).toHaveBeenCalledExactlyOnceWith('alpha', 'All Connections', 'beta', 'after');
    expect(row('Beta').getAttribute('data-drop-placement')).toBeNull();
    expect(screen.getByRole('button', { name: 'Work', expanded: false })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Nested' })).toBeNull();
    onConnectionSelect.mockClear();
    fireEvent.click(row('Beta'), { detail: 1 });
    expect(onConnectionSelect).not.toHaveBeenCalled();
    fireEvent.pointerDown(row('Beta'), { button: 0, isPrimary: true, pointerId: 1, clientX: 1, clientY: 1 });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 1, clientY: 1 });
    fireEvent.click(row('Beta'), { detail: 1 });
    expect(onConnectionSelect).toHaveBeenCalledOnce();
  });

  it('inserts before the target when the pointer is in the top half', () => {
    const reorder = vi.spyOn(ConnectionStorageManager, 'reorderConnection').mockReturnValue(true);
    renderTree();
    const beta = row('Beta');
    setRect(beta, 40, 20);
    hitTarget(beta);
    drag(row('Alpha'), 10, 45);
    expect(reorder).toHaveBeenCalledExactlyOnceWith('alpha', 'All Connections', 'beta', 'before');
  });

  it('does not reorder a click, a right-click, or a filtered list', () => {
    const reorder = vi.spyOn(ConnectionStorageManager, 'reorderConnection').mockReturnValue(false);
    const { onConnectionSelect } = renderTree();
    const alpha = row('Alpha');
    fireEvent.pointerDown(alpha, { button: 0, isPrimary: true, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 0, clientY: 2 });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 0, clientY: 2 });
    fireEvent.click(alpha);
    expect(onConnectionSelect).toHaveBeenCalledOnce();

    fireEvent.pointerDown(alpha, { button: 2, isPrimary: true, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 30, clientY: 30 });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 30, clientY: 30 });
    expect(reorder).not.toHaveBeenCalled();

    const beta = row('Beta');
    setRect(beta, 40, 20);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search connections' }), { target: { value: 'Alpha' } });
    hitTarget(beta);
    drag(row('Alpha'), 10, 55);
    expect(reorder).not.toHaveBeenCalled();
  });

  it('reorders sibling folders from the row edge and moves into a folder from the middle', () => {
    const reorderFolder = vi.spyOn(ConnectionStorageManager, 'reorderFolder').mockReturnValue(true);
    const moveFolder = vi.spyOn(ConnectionStorageManager, 'moveFolder').mockReturnValue(true);
    renderTree();

    const personal = row('Personal');
    setRect(personal, 100, 28);
    hitTarget(personal);
    drag(row('Work'), 12, 104);
    expect(reorderFolder).toHaveBeenCalledExactlyOnceWith('work', 'personal', 'before');
    expect(moveFolder).not.toHaveBeenCalled();

    reorderFolder.mockClear();
    drag(row('Work'), 12, 114);
    expect(reorderFolder).not.toHaveBeenCalled();
    expect(moveFolder).toHaveBeenCalledExactlyOnceWith('work', 'All Connections/Personal');
  });

  it('moves a connection into another folder', () => {
    const move = vi.spyOn(ConnectionStorageManager, 'moveConnection').mockReturnValue(true);
    renderTree();
    const personal = row('Personal');
    setRect(personal, 100, 28);
    hitTarget(personal);
    drag(row('Alpha'), 12, 114);
    expect(move).toHaveBeenCalledExactlyOnceWith('alpha', 'All Connections/Personal');
  });

  it.each(['pointercancel', 'Escape', 'blur', 'capture loss', 'search', 'unmount'])('cancels on %s without persisting', (reason) => {
    const reorder = vi.spyOn(ConnectionStorageManager, 'reorderConnection').mockReturnValue(true);
    const { unmount } = renderTree();
    const alpha = row('Alpha');
    const beta = row('Beta');
    setRect(beta, 40, 28);
    hitTarget(beta);
    // jsdom 28 rejects cursor keywords; emulate the CSS property for restoration checks.
    Object.defineProperty(document.body.style, 'cursor', { configurable: true, writable: true, value: '' });
    document.body.style.cursor = 'crosshair';
    document.body.style.userSelect = 'text';
    const capture = vi.fn();
    const release = vi.fn();
    alpha.setPointerCapture = capture;
    alpha.hasPointerCapture = () => true;
    alpha.releasePointerCapture = release;
    fireEvent.pointerDown(alpha, { button: 0, isPrimary: true, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 10, clientY: 60 });
    expect(capture).toHaveBeenCalledWith(1);
    expect(alpha.classList.contains('opacity-50')).toBe(true);
    expect(beta.dataset.dropPlacement).toBe('after');

    switch (reason) {
      case 'pointercancel': fireEvent.pointerCancel(document, { pointerId: 1, clientX: 10, clientY: 60 }); break;
      case 'Escape': fireEvent.keyDown(document, { key: 'Escape' }); break;
      case 'blur': fireEvent.blur(window); break;
      case 'capture loss': fireEvent.lostPointerCapture(alpha, { pointerId: 1 }); break;
      case 'search': fireEvent.change(screen.getByRole('textbox', { name: 'Search connections' }), { target: { value: 'Alpha' } }); break;
      case 'unmount': unmount(); break;
    }
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 20, clientY: 60 });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 20, clientY: 60 });
    expect(reorder).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(1);
    expect(document.body.style.cursor).toBe('crosshair');
    expect(document.body.style.userSelect).toBe('text');
    expect(document.querySelector('[data-drop-placement]')).toBeNull();
    expect(document.querySelector('[data-connection-row].opacity-50')).toBeNull();
  });

  it('ignores other pointers and allows keyboard actions immediately after dragging', () => {
    const reorder = vi.spyOn(ConnectionStorageManager, 'reorderConnection').mockReturnValue(true);
    const { onConnectionSelect, onConnectionConnect } = renderTree();
    const alpha = row('Alpha');
    const beta = row('Beta');
    setRect(beta, 40, 28);
    hitTarget(beta);
    fireEvent.pointerDown(alpha, { button: 0, isPrimary: true, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { pointerId: 2, clientX: 10, clientY: 60 });
    expect(alpha.classList.contains('opacity-50')).toBe(false);
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 10, clientY: 60 });
    fireEvent.pointerCancel(document, { pointerId: 2, clientX: 10, clientY: 60 });
    fireEvent.pointerUp(document, { pointerId: 2, clientX: 10, clientY: 60 });
    expect(reorder).not.toHaveBeenCalled();
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 10, clientY: 60 });
    expect(reorder).toHaveBeenCalledOnce();
    fireEvent.click(beta, { detail: 1 });
    fireEvent.doubleClick(beta, { detail: 2 });
    expect(onConnectionSelect).not.toHaveBeenCalled();
    expect(onConnectionConnect).not.toHaveBeenCalled();
    fireEvent.keyDown(beta, { key: ' ' });
    fireEvent.keyDown(beta, { key: 'Enter' });
    expect(onConnectionSelect).toHaveBeenCalledOnce();
    expect(onConnectionConnect).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Work', expanded: true }), { detail: 0 });
    expect(screen.getByRole('button', { name: 'Work', expanded: false })).toBeTruthy();
    fireEvent.pointerDown(document.body, { button: 0, isPrimary: true, pointerId: 1 });
    fireEvent.doubleClick(beta, { detail: 2 });
    expect(onConnectionConnect).toHaveBeenCalledTimes(2);
  });

  it('excludes folder buttons and the root from drag initiation', () => {
    const reorder = vi.spyOn(ConnectionStorageManager, 'reorderFolder').mockReturnValue(true);
    const move = vi.spyOn(ConnectionStorageManager, 'moveFolder').mockReturnValue(true);
    renderTree();
    const personal = row('Personal');
    setRect(personal, 100, 28);
    hitTarget(personal);
    drag(screen.getByRole('button', { name: 'Work', expanded: true }), 12, 114);
    drag(row('All Connections'), 12, 114);
    expect(reorder).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
  });

  it('keeps collapsed folders collapsed when connection status changes', () => {
    const { rerender, onConnectionSelect } = renderTree();
    fireEvent.click(screen.getByRole('button', { name: 'Work', expanded: true }));
    rerender(<ConnectionManager onConnectionSelect={onConnectionSelect} selectedConnectionId={null} activeConnections={new Set(['alpha'])} />);
    expect(screen.getByRole('button', { name: 'Work', expanded: false })).toBeTruthy();
  });

  it('does not highlight or commit a folder drop with a colliding name', () => {
    const nodes = structuredClone(tree);
    const personalNode = nodes[0].children?.find((node) => node.id === 'personal');
    if (!personalNode) throw new Error('Missing folder');
    personalNode.isExpanded = false;
    personalNode.children = [{ id: 'collision', name: 'Work', type: 'folder', path: 'All Connections/Personal/Work', children: [] }];
    const move = vi.spyOn(ConnectionStorageManager, 'moveFolder').mockReturnValue(true);
    renderTree(nodes);
    const personal = row('Personal');
    setRect(personal, 100, 28);
    hitTarget(personal);
    fireEvent.pointerDown(row('Work'), { button: 0, isPrimary: true, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 10, clientY: 114 });
    expect(personal.dataset.dropPlacement).toBeUndefined();
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 10, clientY: 114 });
    expect(move).not.toHaveBeenCalled();
  });

  it.each([1, 99])('scrolls continuously near the edge at y=%s, updates the drop target, and cancels frames', (y) => {
    const reorder = vi.spyOn(ConnectionStorageManager, 'reorderConnection').mockReturnValue(true);
    renderTree();
    const container = row('All Connections').parentElement?.parentElement;
    if (!container) throw new Error('Missing scroll container');
    setRect(container, 0, 100);
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 100 });
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 1000 });
    container.scrollTop = 100;
    const beta = row('Beta');
    const nested = row('Nested');
    setRect(beta, 0, 100);
    setRect(nested, 0, 100);
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => container.scrollTop === 100 ? beta : nested,
    });
    const frames = new Map<number, FrameRequestCallback>();
    let id = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
    vi.stubGlobal('cancelAnimationFrame', (frameId: number) => { frames.delete(frameId); });
    const alpha = row('Alpha');
    fireEvent.pointerDown(alpha, { button: 0, isPrimary: true, pointerId: 1, clientX: 10, clientY: 50 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 10, clientY: y });
    expect(beta.dataset.dropPlacement).toBe(y === 1 ? 'before' : 'after');
    for (let time = 16; time <= 48; time += 16) {
      const pending = [...frames.values()];
      frames.clear();
      act(() => { pending.forEach((callback) => callback(time)); });
    }
    expect(y === 1 ? container.scrollTop < 90 : container.scrollTop > 110).toBe(true);
    expect(beta.dataset.dropPlacement).toBeUndefined();
    expect(nested.dataset.dropPlacement).toBe(y === 1 ? 'before' : 'after');
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 10, clientY: y });
    expect(reorder).toHaveBeenCalledExactlyOnceWith('alpha', 'All Connections/Work', 'nested', y === 1 ? 'before' : 'after');
    expect(frames.size).toBe(0);
  });
});
