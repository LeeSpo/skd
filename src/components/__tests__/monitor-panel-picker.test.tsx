import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MonitorPanelPicker } from '@/components/monitor/monitor-panel-picker';
import type { MonitorPanelId } from '@/lib/monitor-panel-types';

function Picker() {
  const [enabled, setEnabled] = useState(new Set<MonitorPanelId>(['overview', 'disk']));
  return <MonitorPanelPicker enabled={enabled} onChange={setEnabled} />;
}

afterEach(cleanup);

describe('MonitorPanelPicker', () => {
  it('keeps panel controls in a menu and supports multiple changes without closing it', async () => {
    render(<Picker />);
    const trigger = screen.getByRole('button', { name: 'Panels' });
    expect(screen.queryByRole('menuitemcheckbox')).toBeNull();

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const overview = await screen.findByRole('menuitemcheckbox', { name: 'Overview' });
    const disk = screen.getByRole('menuitemcheckbox', { name: 'Disk' });
    const network = screen.getByRole('menuitemcheckbox', { name: 'Network' });
    expect(overview.getAttribute('aria-checked')).toBe('true');
    expect(disk.getAttribute('aria-checked')).toBe('true');
    expect(network.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(network);
    expect(network.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(overview);
    expect(overview.getAttribute('aria-checked')).toBe('false');
    expect(disk.getAttribute('aria-checked')).toBe('true');
    expect(screen.getAllByRole('menuitemcheckbox')).toHaveLength(6);
  });

  it('can disable every panel and reopen the menu to enable one again', async () => {
    render(<Picker />);
    const trigger = screen.getByRole('button', { name: 'Panels' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Overview' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Disk' }));
    expect(screen.getAllByRole('menuitemcheckbox').every(item => item.getAttribute('aria-checked') === 'false')).toBe(true);

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const overview = await screen.findByRole('menuitemcheckbox', { name: 'Overview' });
    fireEvent.click(overview);
    expect(overview.getAttribute('aria-checked')).toBe('true');
  });
});
