import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sonnerState = vi.hoisted(() => ({
  dismissCalls: [] as Array<string | number | undefined>,
  nextId: 1,
  subscribers: new Set<(toast: Record<string, unknown>) => void>(),
  toasterProps: undefined as Record<string, unknown> | undefined,
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'dark' }),
}));

vi.mock('sonner', async () => {
  const ReactModule = await import('react');

  type MockToast = {
    id: string | number;
    title: React.ReactNode;
    toasterId?: string;
    position?: string;
    dismissible?: boolean;
    action?: {
      label: React.ReactNode;
      onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
    };
  };

  const publish = (toastData: Record<string, unknown>) => {
    sonnerState.subscribers.forEach((subscriber) => subscriber(toastData));
  };

  const createToast = (title: React.ReactNode, options: Record<string, unknown> = {}) => {
    const id = typeof options.id === 'string' || typeof options.id === 'number'
      ? options.id
      : sonnerState.nextId++;
    publish({ id, title, dismissible: true, ...options });
    return id;
  };

  const dismiss = (id?: string | number) => {
    sonnerState.dismissCalls.push(id);
    publish({ id, dismiss: true });
    return id;
  };

  const toast = Object.assign(createToast, {
    success: createToast,
    error: createToast,
    warning: createToast,
    info: createToast,
    loading: createToast,
    dismiss,
  });

  const useSonner = () => {
    const [toasts, setToasts] = ReactModule.useState<MockToast[]>([]);

    ReactModule.useEffect(() => {
      const subscriber = (toastData: Record<string, unknown>) => {
        if (toastData.dismiss) {
          setToasts((current) => current.filter((item) => item.id !== toastData.id));
          return;
        }

        const nextToast = toastData as MockToast;
        setToasts((current) => {
          const existingIndex = current.findIndex((item) => item.id === nextToast.id);
          if (existingIndex >= 0) {
            return current.map((item, index) => index === existingIndex ? nextToast : item);
          }
          return [nextToast, ...current];
        });
      };
      sonnerState.subscribers.add(subscriber);
      return () => sonnerState.subscribers.delete(subscriber);
    }, []);

    return { toasts };
  };

  const MockToaster = ReactModule.forwardRef<HTMLElement, Record<string, unknown>>(
    function MockToaster(props, ref) {
      sonnerState.toasterProps = props;
      const { toasts } = useSonner();
      const position = typeof props.position === 'string' ? props.position : 'bottom-right';
      const [yPosition, xPosition] = position.split('-');

      return (
        <section ref={ref} aria-label="Notifications">
          {toasts.map((item, index) => (
            <div
              key={item.id}
              data-sonner-toast=""
              data-index={index}
              data-y-position={yPosition}
              data-x-position={xPosition}
              data-dismissible={item.dismissible !== false}
              data-removed="false"
            >
              <span>{item.title}</span>
              {item.action && (
                <button onClick={item.action.onClick}>{item.action.label}</button>
              )}
            </div>
          ))}
        </section>
      );
    },
  );

  return {
    Toaster: MockToaster,
    toast,
    useSonner,
  };
});

import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import {
  APP_SETTINGS_CHANGED_EVENT,
  APP_SETTINGS_STORAGE_KEY,
} from '@/lib/keyboard-shortcuts';

describe('application toaster', () => {
  beforeEach(() => {
    localStorage.clear();
    sonnerState.dismissCalls = [];
    sonnerState.nextId = 1;
    sonnerState.subscribers.clear();
    sonnerState.toasterProps = undefined;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('uses a three-second default while preserving an explicit duration', () => {
    const { rerender } = render(<Toaster />);

    expect(sonnerState.toasterProps?.duration).toBe(3000);

    rerender(<Toaster duration={5000} />);
    expect(sonnerState.toasterProps?.duration).toBe(5000);
  });

  it('dismisses only the clicked toast card', () => {
    render(<Toaster position="top-right" />);
    act(() => {
      toast.success('First notification', { id: 'first' });
      toast.info('Second notification', { id: 'second' });
    });

    fireEvent.click(screen.getByText('First notification'));

    expect(sonnerState.dismissCalls).toEqual(['first']);
    expect(screen.queryByText('First notification')).toBeNull();
    expect(screen.getByText('Second notification')).not.toBeNull();
  });

  it('leaves interactive actions in control of their clicks', () => {
    const handleAction = vi.fn();
    render(<Toaster />);
    act(() => {
      toast.success('Download complete', {
        action: { label: 'Open file', onClick: handleAction },
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open file' }));

    expect(handleAction).toHaveBeenCalledOnce();
    expect(sonnerState.dismissCalls).toEqual([]);
  });

  it('does not dismiss a non-dismissible toast when its card is clicked', () => {
    render(<Toaster />);
    act(() => {
      toast.loading('Working', { id: 'working', dismissible: false });
    });

    fireEvent.click(screen.getByText('Working'));
    expect(sonnerState.dismissCalls).toEqual([]);
  });

  it('does not dismiss a toast while the user has selected text', () => {
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'selected notification text',
    } as Selection);
    render(<Toaster />);
    act(() => {
      toast.info('Selectable details');
    });

    fireEvent.click(screen.getByText('Selectable details'));
    expect(sonnerState.dismissCalls).toEqual([]);
  });

  it('defaults to enabled when saved settings are missing or malformed', () => {
    const { unmount } = render(<Toaster />);
    expect(screen.getByLabelText('Notifications')).not.toBeNull();

    unmount();
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, '{invalid json');
    render(<Toaster />);
    expect(screen.getByLabelText('Notifications')).not.toBeNull();
  });

  it('applies setting changes immediately without replaying suppressed notifications', () => {
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({ enableNotifications: false }),
    );
    render(<Toaster />);
    expect(screen.queryByLabelText('Notifications')).toBeNull();

    act(() => {
      toast.info('Suppressed notification');
      localStorage.setItem(
        APP_SETTINGS_STORAGE_KEY,
        JSON.stringify({ enableNotifications: true }),
      );
      window.dispatchEvent(new Event(APP_SETTINGS_CHANGED_EVENT));
    });

    expect(screen.getByLabelText('Notifications')).not.toBeNull();
    expect(screen.queryByText('Suppressed notification')).toBeNull();

    act(() => {
      toast.success('Visible notification');
    });
    expect(screen.getByText('Visible notification')).not.toBeNull();

    act(() => {
      localStorage.setItem(
        APP_SETTINGS_STORAGE_KEY,
        JSON.stringify({ enableNotifications: false }),
      );
      window.dispatchEvent(new Event(APP_SETTINGS_CHANGED_EVENT));
    });
    expect(screen.queryByLabelText('Notifications')).toBeNull();
  });

  it('responds to storage events from another window', () => {
    render(<Toaster />);
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({ enableNotifications: false }),
    );

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: APP_SETTINGS_STORAGE_KEY }));
    });

    expect(screen.queryByLabelText('Notifications')).toBeNull();
  });
});
