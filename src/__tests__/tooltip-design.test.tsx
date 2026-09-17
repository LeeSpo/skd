import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

function Hint() {
  return <Tooltip><TooltipTrigger>Action</TooltipTrigger><TooltipContent>Action hint</TooltipContent></Tooltip>;
}

beforeEach(() => {
  // jsdom has no layout observer; leave Radix interactions and timers real.
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('tooltip design contract', () => {
  it('opens on keyboard focus and closes with Escape', () => {
    render(<Hint />);
    act(() => screen.getByRole('button').focus());
    expect(screen.getByRole('tooltip').textContent).toBe('Action hint');
    const content = document.querySelector('[data-slot="tooltip-content"]')!;
    expect(content.classList.contains('bg-popover')).toBe(true);
    expect(content.classList.contains('text-popover-foreground')).toBe(true);
    expect(content.classList.contains('break-words')).toBe(true);
    expect(content.className).toContain('max-w-');
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it.each([undefined, 700])('honors hover delay from the nearest provider (%s)', delay => {
    vi.useFakeTimers();
    render(delay === undefined ? <Hint /> : <TooltipProvider delayDuration={delay}><Hint /></TooltipProvider>);
    fireEvent.pointerMove(screen.getByRole('button'), { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime((delay ?? 400) - 1));
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('tooltip')).toBeTruthy();
  });
});
