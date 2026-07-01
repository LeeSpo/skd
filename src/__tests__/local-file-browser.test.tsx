import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { LocalFileBrowser } from '../components/local-file-browser';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        'filePanel.panel.local': 'Local',
        'filePanel.panel.remote': 'Remote',
        'filePanel.toolbar.goUp': 'Go up',
        'filePanel.toolbar.home': 'Home',
        'filePanel.toolbar.refresh': 'Refresh',
        'filePanel.toolbar.filter': 'Filter',
        'filePanel.statusBar.items': '{{count}} item(s)',
      };
      return labels[key] ?? key;
    },
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockedInvoke.mockImplementation(async (command: string) => {
    if (command === 'get_home_directory') {
      return '/Users/test';
    }
    if (command === 'list_local_files') {
      return [];
    }
    throw new Error(`Unexpected invoke: ${command}`);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('LocalFileBrowser', () => {
  it('shows home path in panel header instead of duplicating Local', async () => {
    render(<LocalFileBrowser />);

    await waitFor(() => {
      expect(screen.getAllByText('/Users/test').length).toBeGreaterThanOrEqual(1);
    });

    expect(screen.getAllByText('Local')).toHaveLength(1);
  });
});