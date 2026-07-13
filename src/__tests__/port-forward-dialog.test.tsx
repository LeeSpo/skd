import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PortForwardDialog } from '@/components/port-forward-dialog';

const mocks = vi.hoisted(() => ({
  listLocalForwards: vi.fn(),
  startLocalForward: vi.fn(),
  stopLocalForward: vi.fn(),
  testLocalForward: vi.fn(),
  getPortForwardBookmarks: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/lib/port-forward', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/port-forward')>();
  return {
    ...actual,
    listLocalForwards: mocks.listLocalForwards,
    startLocalForward: mocks.startLocalForward,
    stopLocalForward: mocks.stopLocalForward,
    testLocalForward: mocks.testLocalForward,
  };
});

vi.mock('@/lib/port-forward-bookmarks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/port-forward-bookmarks')>();
  return { ...actual, getPortForwardBookmarks: mocks.getPortForwardBookmarks };
});

const activeForward = {
  id: 'pf-1',
  connection_id: 'conn-1',
  bookmark_id: 'bookmark-1',
  name: 'Database',
  local_bind_host: '127.0.0.1',
  local_port: 15432,
  remote_host: 'localhost',
  remote_port: 5432,
  local_status: 'listening' as const,
  target_status: 'unreachable' as const,
  last_error: 'connection refused',
  last_checked_at: Date.now(),
};

describe('PortForwardDialog', () => {
  beforeEach(() => {
    mocks.listLocalForwards.mockResolvedValue([activeForward]);
    mocks.testLocalForward.mockResolvedValue({ ...activeForward, target_status: 'reachable' });
    mocks.getPortForwardBookmarks.mockReturnValue([{
      id: 'bookmark-1',
      connectionProfileId: 'profile-1',
      name: 'Database',
      localBindHost: '127.0.0.1',
      localPort: 15432,
      remoteHost: 'localhost',
      remotePort: 5432,
      autoStart: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows saved bookmarks and separate listener/target states, then retests', async () => {
    render(
      <PortForwardDialog
        open
        onOpenChange={vi.fn()}
        connectionId="conn-1"
        connectionProfileId="profile-1"
        connectionName="Server"
        canManage
      />,
    );

    expect(await screen.findByText('portForward.section.saved')).not.toBeNull();
    expect(screen.getByText('portForward.status.listening')).not.toBeNull();
    expect(screen.getByText('portForward.status.unreachable')).not.toBeNull();
    expect(screen.getByText('portForward.status.autoStart')).not.toBeNull();

    fireEvent.click(screen.getByTitle('portForward.action.test'));
    await waitFor(() => expect(mocks.testLocalForward).toHaveBeenCalledWith('conn-1', 'pf-1'));
  });
});
