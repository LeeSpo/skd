import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionManager } from '../components/connection-manager';
import { ConnectionStorageManager } from '../lib/connection-storage';

describe('ConnectionManager tree layout', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('exposes folder disclosure and activates it once without bubbling', () => {
    vi.spyOn(ConnectionStorageManager, 'buildConnectionTree').mockReturnValue([
      { id: 'folder', name: 'Production', type: 'folder', isExpanded: false, children: [] },
    ]);
    const onSelect = vi.fn();
    render(<ConnectionManager onConnectionSelect={onSelect} selectedConnectionId={null} />);
    const disclosure = screen.getByRole('button', { name: 'Production', expanded: false });
    expect(disclosure.tabIndex).toBe(0);
    disclosure.focus();
    expect(document.activeElement).toBe(disclosure);
    fireEvent.click(disclosure);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Production', expanded: true })).toBe(disclosure);
    fireEvent.click(disclosure);
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps actions accessible and only offers details for a selected connection', () => {
    vi.spyOn(ConnectionStorageManager, 'buildConnectionTree').mockReturnValue([
      { id: 'host', name: 'Production', type: 'connection', protocol: 'SSH', host: 'example.test' },
    ]);
    const onNewConnection = vi.fn();
    const { container, rerender } = render(
      <ConnectionManager onConnectionSelect={() => {}} selectedConnectionId={null} onNewConnection={onNewConnection} />,
    );
    expect(container.querySelector('details')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'New Connection' }));
    expect(onNewConnection).toHaveBeenCalledOnce();
    rerender(<ConnectionManager onConnectionSelect={() => {}} selectedConnectionId="host" />);
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toContain('Connection Details');
    expect(details?.textContent).toContain('example.test');
  });

});
