import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ComposePane } from '../components/compose-pane';
import { TerminalGroupProvider } from '../lib/terminal-group-context';
import { TerminalInputProvider } from '../lib/terminal-input-context';

const mocks = vi.hoisted(() => ({
  sendToTerminal: vi.fn(() => true),
  activeTab: {
    id: 'conn-1',
    name: 'server',
    tabType: 'terminal' as const,
    connectionStatus: 'connected' as const,
    protocol: 'SSH',
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../lib/terminal-group-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/terminal-group-context')>();
  return {
    ...actual,
    useTerminalGroups: () => ({
      activeTab: mocks.activeTab,
      activeGroup: null,
      activeConnection: null,
      state: { groups: {}, activeGroupId: '1', gridLayout: { type: 'leaf', groupId: '1' } },
      dispatch: vi.fn(),
    }),
  };
});

vi.mock('../lib/terminal-input-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/terminal-input-context')>();
  return {
    ...actual,
    useTerminalInput: () => ({
      registerSender: vi.fn(),
      unregisterSender: vi.fn(),
      sendToTerminal: mocks.sendToTerminal,
    }),
  };
});

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function renderComposePane() {
  return render(
    <TerminalGroupProvider>
      <TerminalInputProvider>
        <ComposePane />
      </TerminalInputProvider>
    </TerminalGroupProvider>,
  );
}

describe('ComposePane', () => {
  beforeEach(() => {
    mocks.sendToTerminal.mockReset();
    mocks.sendToTerminal.mockReturnValue(true);
    mocks.activeTab = {
      id: 'conn-1',
      name: 'server',
      tabType: 'terminal',
      connectionStatus: 'connected',
      protocol: 'SSH',
    };
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows empty state when active tab is not a terminal', () => {
    mocks.activeTab = {
      id: 'fb-1',
      name: 'files',
      tabType: 'file-browser',
      connectionStatus: 'connected',
      protocol: 'SFTP',
    };

    renderComposePane();
    expect(screen.getByText('composePane.emptyState.noTerminal')).not.toBeNull();
  });

  it('sends draft to active terminal when Send is clicked', () => {
    renderComposePane();

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'echo hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'composePane.send' }));

    expect(mocks.sendToTerminal).toHaveBeenCalledWith(
      'conn-1',
      'echo hello',
      expect.objectContaining({ bracketedPaste: false, submitChar: '\r' }),
    );
  });

  it('sends on Ctrl+Enter', () => {
    renderComposePane();

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'echo hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    expect(mocks.sendToTerminal).toHaveBeenCalledWith(
      'conn-1',
      'echo hello',
      expect.objectContaining({ bracketedPaste: false, submitChar: '\r' }),
    );
  });

  it('clears draft after send when clear-after-send is enabled', () => {
    localStorage.setItem('skd-compose-clear-after-send', 'true');
    renderComposePane();

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'echo hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'composePane.send' }));

    expect((textarea as HTMLTextAreaElement).value).toBe('');
    expect(sessionStorage.getItem('skd-compose-draft-conn-1')).toBeNull();
  });

  it('keeps failed sends visible and retains the draft until a successful retry', () => {
    mocks.sendToTerminal.mockReturnValue(false);
    renderComposePane();
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'echo hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'composePane.send' }));
    expect(screen.getByRole('alert').textContent).toBe('composePane.toast.sendFailed');
    expect(textarea.value).toBe('echo hello');
    mocks.sendToTerminal.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'composePane.send' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not submit while composing text', () => {
    renderComposePane();
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true, isComposing: true });
    expect(mocks.sendToTerminal).not.toHaveBeenCalled();
  });

  it('disables send when terminal is disconnected', () => {
    mocks.activeTab = {
      ...mocks.activeTab,
      connectionStatus: 'disconnected',
    };

    renderComposePane();

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'echo hello' } });

    const sendButton = screen.getByRole('button', { name: 'composePane.send' });
    expect(sendButton.hasAttribute('disabled')).toBe(true);
    expect((textarea as HTMLTextAreaElement).disabled).toBe(true);
  });
});