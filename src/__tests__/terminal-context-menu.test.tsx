import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TerminalContextMenu } from '../components/terminal/terminal-context-menu';

const baseProps = {
  onCopy: vi.fn(),
  onPaste: vi.fn(),
  onClear: vi.fn(),
  onClearScrollback: vi.fn(),
  onSearch: vi.fn(),
  onSelectAll: vi.fn(),
  onSaveToFile: vi.fn(),
  hasSelection: false,
};

describe('TerminalContextMenu', () => {
  it('hides link actions when no linkUrl is set', async () => {
    render(
      <TerminalContextMenu {...baseProps} linkUrl={null}>
        <button type="button">terminal</button>
      </TerminalContextMenu>,
    );

    fireEvent.contextMenu(screen.getByRole('button'));
    const menu = await screen.findByRole('menu');

    expect(menu.textContent).not.toContain('Open Link');
    expect(menu.textContent).not.toContain('Copy Link');
  });

  it('disables Copy and hints at Option-drag when nothing is selected', async () => {
    render(
      <TerminalContextMenu {...baseProps} hasSelection={false}>
        <button type="button">terminal</button>
      </TerminalContextMenu>,
    );

    fireEvent.contextMenu(screen.getByRole('button'));
    const copyItem = await screen.findByRole('menuitem', { name: /copy/i });

    expect(copyItem.getAttribute('aria-disabled')).toBe('true');
    expect(copyItem.getAttribute('title')).toBe('Hold ⌥ and drag to select');
    expect(copyItem.textContent).toContain('⌥ & drag');
  });

  it('enables Copy with the keyboard shortcut when text is selected', async () => {
    render(
      <TerminalContextMenu {...baseProps} hasSelection={true}>
        <button type="button">terminal</button>
      </TerminalContextMenu>,
    );

    fireEvent.contextMenu(screen.getByRole('button'));
    const copyItem = await screen.findByRole('menuitem', { name: /copy/i });

    expect(copyItem.getAttribute('aria-disabled')).not.toBe('true');
    expect(copyItem.getAttribute('title')).toBeNull();
    expect(copyItem.textContent).toContain('⌘+C');
  });

  it('shows Open Link and Copy Link at the top when linkUrl is set', async () => {
    render(
      <TerminalContextMenu
        {...baseProps}
        linkUrl="https://example.com"
        onOpenLink={vi.fn()}
        onCopyLink={vi.fn()}
      >
        <button type="button">terminal</button>
      </TerminalContextMenu>,
    );

    fireEvent.contextMenu(screen.getByRole('button'));
    const menu = await screen.findByRole('menu');

    expect(menu.textContent?.startsWith('Open Link')).toBe(true);
    expect(menu.textContent).toContain('Copy Link');
  });
});
