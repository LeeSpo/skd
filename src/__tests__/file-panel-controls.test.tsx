import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FilePanel } from '@/components/file-panel';
import type { FileEntry } from '@/lib/file-entry-types';

const entries: FileEntry[] = [{ name: 'report.txt', file_type: 'File', size: 128, permissions: '-rw-r--r--', modified: '2026-10-03' }];
const load = vi.fn(async () => entries);
beforeEach(() => { localStorage.clear(); load.mockClear(); });
afterEach(cleanup);

function panel(mode: 'local' | 'remote', transfer = vi.fn(), sync?: () => void) {
  return <FilePanel mode={mode} label={mode} isActive initialPath="/files" onLoadDirectory={load}
    onFocus={vi.fn()} showPermissions={mode === 'remote'} onTransferToOther={transfer} onSyncDirectories={sync} />;
}

it('shares optional columns between panes and restores the choice on remount', async () => {
  const first = render(<>{panel('remote')}{panel('remote')}{panel('local')}</>);
  await screen.findAllByText('report.txt');
  expect(screen.queryByRole('columnheader', { name: 'Perms' })).toBeNull();
  fireEvent.keyDown(screen.getAllByRole('button', { name: 'More file actions' })[0], { key: 'Enter' });
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Columns' }), { key: 'ArrowRight' });
  fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Permissions' }));
  expect(screen.getAllByRole('columnheader', { name: 'Perms', hidden: true })).toHaveLength(2);
  expect(JSON.parse(localStorage.getItem('skd-file-browser-visible-columns')!)).toEqual(['permissions']);
  first.unmount();
  render(panel('remote'));
  await screen.findByText('report.txt');
  expect(screen.getByRole('columnheader', { name: 'Perms' })).toBeTruthy();
});

it('transfers the selection from each toolbar and keeps directory sync available', async () => {
  const upload = vi.fn(), download = vi.fn(), sync = vi.fn();
  const { container } = render(<>{panel('local', upload)}{panel('remote', download, sync)}</>);
  await screen.findAllByText('report.txt');
  expect(screen.getByRole('button', { name: 'Upload 0 selected' }).hasAttribute('disabled')).toBe(true);
  const local = within(container.querySelector('[data-panel-mode="local"]') as HTMLElement);
  fireEvent.click(local.getByText('report.txt'));
  fireEvent.click(local.getByRole('button', { name: 'Upload 1 selected' }));
  expect(upload).toHaveBeenCalledWith(entries, '/files');
  const remote = within(container.querySelector('[data-panel-mode="remote"]') as HTMLElement);
  fireEvent.click(remote.getByText('report.txt'));
  fireEvent.click(remote.getByRole('button', { name: 'Download 1 selected' }));
  expect(download).toHaveBeenCalledWith(entries, '/files');
  fireEvent.keyDown(remote.getByRole('button', { name: 'More file actions' }), { key: 'Enter' });
  fireEvent.click(screen.getByRole('menuitem', { name: /Sync directories/ }));
  expect(sync).toHaveBeenCalledOnce();
});
