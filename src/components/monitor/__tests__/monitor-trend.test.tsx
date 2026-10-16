import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MonitorTrend, type TrendSeries } from '../monitor-trend';

const base = 1700000000000;
const speed: TrendSeries = {
  id: 'download', label: 'Download', color: 'var(--chart-1)', formatValue: value => `${value} KB/s`,
  points: [{ timestamp: base, value: 10 }, { timestamp: base + 5000, value: 20 }, { timestamp: base + 15000, value: 30 }],
};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MonitorTrend', () => {
  it('shows an unfocusable waiting state and draws a marker for a single sample', () => {
    const { container, rerender } = render(<MonitorTrend label="Traffic" series={[]} />);
    expect(screen.getByText('Waiting for samples…')).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Traffic' }).getAttribute('tabindex')).toBeNull();
    rerender(<MonitorTrend label="Traffic" series={[{ ...speed, points: speed.points.slice(0, 1) }]} />);
    expect(screen.getByText('10 KB/s')).not.toBeNull();
    expect(container.querySelectorAll('.monitor-trend-dot')).toHaveLength(1);
    expect(container.querySelector('svg[viewBox]')?.getAttribute('preserveAspectRatio')).toBe('none');
  });

  it('exposes exact samples with keyboard navigation and closes details with Escape', async () => {
    render(<MonitorTrend label="Traffic" series={[speed]} />);
    const plot = screen.getByRole('group', { name: 'Traffic' });
    act(() => plot.focus());
    let tooltip = await screen.findByRole('tooltip');
    expect(plot.getAttribute('aria-describedby')).toBe(tooltip.id);
    expect(within(tooltip).getByText('30 KB/s')).not.toBeNull();
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    tooltip = screen.getByRole('tooltip');
    expect(within(tooltip).getByText('20 KB/s')).not.toBeNull();
    fireEvent.keyDown(plot, { key: 'Home' });
    expect(within(screen.getByRole('tooltip')).getByText('10 KB/s')).not.toBeNull();
    fireEvent.keyDown(plot, { key: 'End' });
    expect(within(screen.getByRole('tooltip')).getByText('30 KB/s')).not.toBeNull();
    fireEvent.keyDown(plot, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
    expect(document.activeElement).toBe(plot);
  });

  it('selects the nearest timestamp from pointer position without inventing missing series values', async () => {
    render(<MonitorTrend label="Traffic" series={[speed, {
      id: 'upload', label: 'Upload', color: 'var(--chart-5)', dash: '4 3', formatValue: value => `${value} KB/s`,
      points: [{ timestamp: base, value: 5 }, { timestamp: base + 15000, value: 15 }],
    }]} />);
    const plot = screen.getByRole('group', { name: 'Traffic' });
    vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 300, top: 0, right: 300, bottom: 40, height: 40, x: 0, y: 0, toJSON() {} });
    act(() => plot.focus());
    fireEvent.pointerMove(plot, { clientX: 102, pointerType: 'mouse' });
    const tooltip = await screen.findByRole('tooltip');
    expect(within(tooltip).getByText('20 KB/s')).not.toBeNull();
    expect(within(tooltip).getByText('—')).not.toBeNull();
    expect(within(tooltip).getByText(new Date(base + 5000).toLocaleTimeString())).not.toBeNull();
  });

  it('keeps the latest sample available when history rolls over or becomes empty', async () => {
    const { rerender } = render(<MonitorTrend label="Traffic" series={[speed]} showLegend={false} />);
    const plot = screen.getByRole('group', { name: 'Traffic' });
    act(() => plot.focus());
    fireEvent.keyDown(plot, { key: 'Home' });
    rerender(<MonitorTrend label="Traffic" series={[{ ...speed, points: speed.points.slice(1) }]} showLegend={false} />);
    expect(within(await screen.findByRole('tooltip')).getByText('30 KB/s')).not.toBeNull();
    rerender(<MonitorTrend label="Traffic" series={[]} />);
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
    expect(screen.getByText('Waiting for samples…')).not.toBeNull();
  });
});
