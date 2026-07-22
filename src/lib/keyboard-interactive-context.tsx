import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export const KEYBOARD_INTERACTIVE_PROMPT_EVENT = 'ssh-keyboard-interactive-prompt';

export interface KeyboardInteractivePrompt {
  prompt: string;
  echo: boolean;
}

export interface KeyboardInteractiveChallenge {
  connectionId: string;
  challengeId: string;
  name: string;
  instructions: string;
  prompts: KeyboardInteractivePrompt[];
}

export interface KeyboardInteractiveCoordinator {
  ensureReady: () => Promise<void>;
  finish: (connectionId: string) => void;
}

interface KeyboardInteractiveResponse {
  success: boolean;
  error?: string;
}

const noopCoordinator: KeyboardInteractiveCoordinator = {
  ensureReady: async () => undefined,
  finish: () => undefined,
};

const KeyboardInteractiveContext = createContext<KeyboardInteractiveCoordinator>(noopCoordinator);

async function respondToChallenge(
  challenge: KeyboardInteractiveChallenge,
  responses: string[],
): Promise<void> {
  await invoke<KeyboardInteractiveResponse>('ssh_keyboard_interactive_respond', {
    request: {
      connection_id: challenge.connectionId,
      challenge_id: challenge.challengeId,
      responses,
    },
  });
}

function KeyboardInteractiveChallengeDialog({
  challenge,
  onComplete,
  onCancel,
}: {
  challenge: KeyboardInteractiveChallenge;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [responses, setResponses] = useState(() => challenge.prompts.map(() => ''));
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await respondToChallenge(challenge, responses);
      onComplete();
    } catch (error) {
      toast.error(t('keyboardInteractive.responseFailed'), {
        description: error instanceof Error ? error.message : String(error),
      });
      setIsSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await invoke('ssh_cancel_connect', { connection_id: challenge.connectionId });
    } catch (error) {
      toast.error(t('keyboardInteractive.cancelFailed'), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      onCancel();
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void handleCancel();
      }}
    >
      <DialogContent position="tauri" className="sm:max-w-lg" onEscapeKeyDown={(event) => {
        if (isSubmitting) event.preventDefault();
      }}>
        <DialogHeader>
          <DialogTitle>{challenge.name || t('keyboardInteractive.title')}</DialogTitle>
          <DialogDescription>
            {challenge.instructions || t('keyboardInteractive.description')}
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          {challenge.prompts.map((prompt, index) => {
            const inputId = `keyboard-interactive-${challenge.challengeId}-${index}`;
            return (
              <div className="space-y-2" key={inputId}>
                <Label htmlFor={inputId}>
                  {prompt.prompt || t('keyboardInteractive.responseLabel', { count: index + 1 })}
                </Label>
                <Input
                  id={inputId}
                  type={prompt.echo ? 'text' : 'password'}
                  autoComplete="off"
                  autoFocus={index === 0}
                  value={responses[index] ?? ''}
                  disabled={isSubmitting}
                  onChange={(event) => {
                    const value = event.target.value;
                    setResponses((current) => current.map((response, responseIndex) => (
                      responseIndex === index ? value : response
                    )));
                  }}
                />
              </div>
            );
          })}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => {
              void handleCancel();
            }}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? t('keyboardInteractive.submitting')
                : t('keyboardInteractive.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function KeyboardInteractiveProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [queue, setQueue] = useState<KeyboardInteractiveChallenge[]>([]);
  const listenerPromiseRef = useRef<Promise<void> | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const active = queue[0] ?? null;

  const removeChallenge = useCallback((connectionId: string, challengeId?: string) => {
    setQueue((current) => current.filter((challenge) => (
      challenge.connectionId !== connectionId
      || (challengeId !== undefined && challenge.challengeId !== challengeId)
    )));
  }, []);

  const ensureReady = useCallback(async () => {
    if (!listenerPromiseRef.current) {
      listenerPromiseRef.current = listen<KeyboardInteractiveChallenge>(
        KEYBOARD_INTERACTIVE_PROMPT_EVENT,
        (event) => {
          const challenge = event.payload;
          if (challenge.prompts.length === 0) {
            void respondToChallenge(challenge, []).catch((error: unknown) => {
              toast.error(t('keyboardInteractive.responseFailed'), {
                description: error instanceof Error ? error.message : String(error),
              });
              void invoke('ssh_cancel_connect', { connection_id: challenge.connectionId });
            });
            return;
          }

          setQueue((current) => {
            if (current.some((item) => item.challengeId === challenge.challengeId)) {
              return current;
            }
            return [...current, challenge];
          });
        },
      ).then((unlisten) => {
        unlistenRef.current = unlisten;
      });
    }
    await listenerPromiseRef.current;
  }, [t]);

  const finish = useCallback((connectionId: string) => {
    removeChallenge(connectionId);
  }, [removeChallenge]);

  useEffect(() => () => {
    unlistenRef.current?.();
    unlistenRef.current = null;
  }, []);

  const value = useMemo<KeyboardInteractiveCoordinator>(() => ({
    ensureReady,
    finish,
  }), [ensureReady, finish]);

  return (
    <KeyboardInteractiveContext.Provider value={value}>
      {children}
      {active && (
        <KeyboardInteractiveChallengeDialog
          key={active.challengeId}
          challenge={active}
          onComplete={() => removeChallenge(active.connectionId, active.challengeId)}
          onCancel={() => removeChallenge(active.connectionId)}
        />
      )}
    </KeyboardInteractiveContext.Provider>
  );
}

export function useKeyboardInteractive(): KeyboardInteractiveCoordinator {
  return useContext(KeyboardInteractiveContext);
}
