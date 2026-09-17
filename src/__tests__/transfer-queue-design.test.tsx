import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TransferQueue, type TransferItem } from '@/components/transfer-queue';

afterEach(cleanup);
const item: TransferItem = { id: '1', fileName: 'report.txt', direction: 'upload', sourcePath: '/report.txt', destinationPath: '/tmp/report.txt', status: 'queued', progress: 0, bytesTransferred: 0, totalBytes: 10, speed: 0 };

it('keeps new transfers collapsed and exposes failures without nested buttons', () => {
  const toggle = vi.fn();
  const dispatch = vi.fn();
  const { rerender, container } = render(<TransferQueue transfers={[]} expanded={false} onToggleExpanded={toggle} dispatch={dispatch} />);
  rerender(<TransferQueue transfers={[item]} expanded={false} onToggleExpanded={toggle} dispatch={dispatch} />);
  expect(toggle).not.toHaveBeenCalled();
  rerender(<TransferQueue transfers={[{ ...item, status: 'failed', error: 'Permission denied' }]} expanded={false} onToggleExpanded={toggle} dispatch={dispatch} />);
  expect(screen.getByText(/1 failed/)).toBeTruthy();
  expect(container.querySelector('button button')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /clear/i }));
  expect(dispatch).toHaveBeenCalledWith({ type: 'CLEAR_COMPLETED' });
  expect(toggle).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /transfers/i }));
  expect(toggle).toHaveBeenCalledOnce();
});

it('keeps failure details and retry/cancel actions usable with compact 24px controls', () => {
  const dispatch = vi.fn();
  const { container } = render(<TransferQueue transfers={[
    { ...item, status: 'failed', error: 'Permission denied for report.txt' },
    { ...item, id: '2', status: 'transferring' },
  ]} expanded onToggleExpanded={vi.fn()} dispatch={dispatch} />);
  expect(screen.getByText('Permission denied for report.txt')).toBeTruthy();
  const retry = screen.getByRole('button', { name: 'Retry' });
  const cancel = screen.getByRole('button', { name: 'Cancel' });
  for (const button of [retry, cancel, screen.getByRole('button', { name: 'Clear' })]) {
    expect(button.className).toContain('h-6');
  }
  expect(container.querySelector('[class*="text-[10px]"]')).toBeNull();
  fireEvent.click(retry);
  fireEvent.click(cancel);
  expect(dispatch).toHaveBeenCalledWith({ type: 'RETRY', id: '1' });
  expect(dispatch).toHaveBeenCalledWith({ type: 'CANCEL', id: '2' });
});
