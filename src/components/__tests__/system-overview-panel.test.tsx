import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { SystemOverviewPanel } from '@/components/monitor/system-overview-panel';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function mockStats(memory: { used: number; total: number }, swap = { used: 0, total: 0 }) {
  vi.mocked(invoke).mockResolvedValue({
    cpu_percent: 12.4,
    memory,
    swap,
    disk: { use_percent: 42 },
    uptime: '3 days',
  });
}

describe('SystemOverviewPanel', () => {
  it('shows zero usage with compact capacity and an accessible usage bar', async () => {
    mockStats({ used: 0, total: 16384 });
    render(<SystemOverviewPanel connectionId="server" />);

    expect(await screen.findByText('0 / 16 GB')).not.toBeNull();
    expect(screen.getByRole('progressbar', { name: 'Memory' }).getAttribute('aria-valuenow')).toBe('0');
    expect(screen.queryByText('Swap')).toBeNull();
  });

  it('keeps small capacities in MB and includes configured swap', async () => {
    mockStats({ used: 256, total: 512 }, { used: 256, total: 2048 });
    render(<SystemOverviewPanel connectionId="server" />);

    expect(await screen.findByText('256 / 512 MB')).not.toBeNull();
    expect(screen.getByText('0.3 / 2 GB')).not.toBeNull();
    expect(screen.getByRole('progressbar', { name: 'Swap' }).getAttribute('aria-valuenow')).toBe('12.5');
  });
});
