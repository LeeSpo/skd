import { createRef, useState, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

function MenuFixture({
  controlled = false,
  onOpenChange,
  children,
}: {
  controlled?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <ContextMenu
      open={controlled ? open : undefined}
      onOpenChange={(nextOpen) => {
        if (controlled) setOpen(nextOpen);
        onOpenChange?.(nextOpen);
      }}
    >
      <ContextMenuTrigger asChild><button type="button">SSH tab</button></ContextMenuTrigger>
      <ContextMenuContent>{children}</ContextMenuContent>
    </ContextMenu>
  );
}

function openMenu() {
  const trigger = screen.getByRole('button', { name: 'SSH tab' });
  fireEvent.pointerDown(trigger, { button: 2, pointerType: 'mouse' });
  fireEvent.contextMenu(trigger, { button: 2, clientX: 20, clientY: 20 });
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ContextMenu closing', () => {
  it.each([false, true])('closes before a trailing click can select again (controlled: %s)', async (controlled) => {
    const onAction = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <MenuFixture controlled={controlled} onOpenChange={onOpenChange}>
        <ContextMenuItem onClick={onAction}>Duplicate</ContextMenuItem>
      </MenuFixture>,
    );

    for (let opening = 1; opening <= 2; opening++) {
      openMenu();
      const item = await screen.findByRole('menuitem', { name: 'Duplicate' });
      let connectedAfterRelease = true;
      act(() => {
        // Releasing over an item synthesizes a click. Keep the trailing click
        // in the same event batch to expose a deferred menu close.
        fireEvent.pointerUp(item, { button: 2, pointerType: 'mouse' });
        connectedAfterRelease = item.isConnected;
        fireEvent.click(item);
      });

      expect(onAction).toHaveBeenCalledTimes(opening);
      expect(connectedAfterRelease).toBe(false);
      expect(screen.queryByRole('menu')).toBeNull();
    }
    expect(onOpenChange.mock.calls).toEqual([[true], [false], [true], [false]]);
  });

  it.each(['click', 'Enter', ' '])('preserves selection and reopening with %j', async (input) => {
    const onSelect = vi.fn();
    render(<MenuFixture><ContextMenuItem onSelect={onSelect}>Duplicate</ContextMenuItem></MenuFixture>);

    for (let opening = 1; opening <= 2; opening++) {
      openMenu();
      const item = await screen.findByRole('menuitem', { name: 'Duplicate' });
      if (input === 'click') {
        fireEvent.pointerDown(item, { button: 0, pointerType: 'mouse' });
        fireEvent.mouseDown(item, { button: 0 });
        fireEvent.pointerUp(item, { button: 0, pointerType: 'mouse' });
        fireEvent.mouseUp(item, { button: 0 });
        fireEvent.click(item);
      } else {
        act(() => { item.focus(); });
        fireEvent.keyDown(item, { key: input });
      }
      expect(onSelect).toHaveBeenCalledTimes(opening);
      expect(screen.queryByRole('menu')).toBeNull();
    }
  });

  it('respects a selection that prevents closing', async () => {
    const onSelect = vi.fn((event: Event) => { event.preventDefault(); });
    render(<MenuFixture><ContextMenuItem onSelect={onSelect}>Keep open</ContextMenuItem></MenuFixture>);
    openMenu();
    const item = await screen.findByRole('menuitem', { name: 'Keep open' });

    fireEvent.click(item);
    fireEvent.click(item);

    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('closes the root when selecting a submenu item', async () => {
    const onSelect = vi.fn();
    render(
      <MenuFixture>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Move</ContextMenuSubTrigger>
          <ContextMenuSubContent><ContextMenuItem onSelect={onSelect}>Right</ContextMenuItem></ContextMenuSubContent>
        </ContextMenuSub>
      </MenuFixture>,
    );
    openMenu();
    const submenuTrigger = await screen.findByRole('menuitem', { name: 'Move' });
    act(() => { submenuTrigger.focus(); });
    fireEvent.keyDown(submenuTrigger, { key: 'ArrowRight' });
    const item = await screen.findByRole('menuitem', { name: 'Right' });
    act(() => {
      fireEvent.pointerUp(item, { button: 0, pointerType: 'mouse' });
      fireEvent.click(item);
    });

    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryAllByRole('menu')).toHaveLength(0);
  });

  it('preserves Escape dismissal and caller focus restoration', async () => {
    const triggerRef = createRef<HTMLButtonElement>();
    const onCloseAutoFocus = vi.fn((event: Event) => {
      event.preventDefault();
      triggerRef.current?.focus();
    });
    render(
      <ContextMenu>
        <ContextMenuTrigger asChild><button ref={triggerRef} type="button">SSH tab</button></ContextMenuTrigger>
        <ContextMenuContent onCloseAutoFocus={onCloseAutoFocus}>
          <ContextMenuItem>Duplicate</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );
    openMenu();
    fireEvent.keyDown(await screen.findByRole('menu'), { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
    await waitFor(() => expect(onCloseAutoFocus).toHaveBeenCalledOnce());
    expect(document.activeElement).toBe(triggerRef.current);
  });
});
