import { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KeyboardInteractiveProvider,
  useKeyboardInteractive,
  type KeyboardInteractiveChallenge,
} from '../keyboard-interactive-context';

const invokeMock = vi.fn();
const listenMock = vi.fn();
let promptListener: ((event: { payload: KeyboardInteractiveChallenge }) => void) | undefined;

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

function ReadyHarness() {
  const coordinator = useKeyboardInteractive();
  useEffect(() => {
    void coordinator.ensureReady();
  }, [coordinator]);
  return null;
}

function renderProvider() {
  render(
    <KeyboardInteractiveProvider>
      <ReadyHarness />
    </KeyboardInteractiveProvider>,
  );
}

async function emitChallenge(challenge: KeyboardInteractiveChallenge) {
  await waitFor(() => expect(promptListener).toBeDefined());
  act(() => promptListener?.({ payload: challenge }));
}

beforeEach(() => {
  promptListener = undefined;
  invokeMock.mockReset().mockResolvedValue({ success: true });
  listenMock.mockReset().mockImplementation(
    async (_eventName: string, listener: typeof promptListener) => {
      promptListener = listener;
      return vi.fn();
    },
  );
});

afterEach(() => cleanup());

describe('KeyboardInteractiveProvider', () => {
  it('renders server prompts using the echo flag and submits answers in order', async () => {
    renderProvider();
    await emitChallenge({
      connectionId: 'conn-1',
      challengeId: 'challenge-1',
      name: 'PAM authentication',
      instructions: 'Enter both values',
      prompts: [
        { prompt: 'Password:', echo: false },
        { prompt: 'One-time code:', echo: true },
      ],
    });

    const password = await screen.findByLabelText('Password:');
    const otp = screen.getByLabelText('One-time code:');
    expect(password.getAttribute('type')).toBe('password');
    expect(otp.getAttribute('type')).toBe('text');

    fireEvent.change(password, { target: { value: 'secret' } });
    fireEvent.change(otp, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith(
      'ssh_keyboard_interactive_respond',
      {
        request: {
          connection_id: 'conn-1',
          challenge_id: 'challenge-1',
          responses: ['secret', '123456'],
        },
      },
    ));
  });

  it('automatically acknowledges an empty prompt round', async () => {
    renderProvider();
    await emitChallenge({
      connectionId: 'conn-empty',
      challengeId: 'challenge-empty',
      name: '',
      instructions: '',
      prompts: [],
    });

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith(
      'ssh_keyboard_interactive_respond',
      {
        request: {
          connection_id: 'conn-empty',
          challenge_id: 'challenge-empty',
          responses: [],
        },
      },
    ));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('queues concurrent challenges and shows the next after submission', async () => {
    renderProvider();
    await emitChallenge({
      connectionId: 'conn-a',
      challengeId: 'challenge-a',
      name: 'First challenge',
      instructions: '',
      prompts: [{ prompt: 'First:', echo: true }],
    });
    await emitChallenge({
      connectionId: 'conn-b',
      challengeId: 'challenge-b',
      name: 'Second challenge',
      instructions: '',
      prompts: [{ prompt: 'Second:', echo: true }],
    });

    expect(await screen.findByText('First challenge')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Second challenge')).not.toBeNull();
  });

  it('cancels the whole connection when the user cancels', async () => {
    renderProvider();
    await emitChallenge({
      connectionId: 'conn-cancel',
      challengeId: 'challenge-cancel',
      name: 'Cancel challenge',
      instructions: '',
      prompts: [{ prompt: 'Password:', echo: false }],
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith(
      'ssh_cancel_connect',
      { connection_id: 'conn-cancel' },
    ));
  });
});
