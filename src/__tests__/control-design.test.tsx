import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

afterEach(cleanup);

describe('shared control design', () => {
  it('keeps field semantics and callbacks with opaque theme backgrounds', () => {
    const changed = vi.fn();
    render(<><Input aria-label="Host" aria-invalid onChange={changed} /><Textarea aria-label="Draft" disabled /></>);
    const input = screen.getByRole('textbox', { name: 'Host' });
    const textarea = screen.getByRole('textbox', { name: 'Draft' });
    for (const field of [input, textarea]) {
      expect(field.classList.contains('bg-input-background')).toBe(true);
      expect(field.classList.contains('dark:bg-input/30')).toBe(false);
      expect(field.classList.contains('focus-visible:ring-[3px]')).toBe(true);
      expect(field.classList.contains('motion-reduce:transition-none')).toBe(true);
    }
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect((textarea as HTMLTextAreaElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'example.test' } });
    expect(changed).toHaveBeenCalledOnce();
  });

  it('uses paired destructive colors without changing disabled behavior', () => {
    const remove = vi.fn();
    render(<Button variant="destructive" disabled onClick={remove}>Remove</Button>);
    const button = screen.getByRole('button', { name: 'Remove' });
    expect(button.classList.contains('text-destructive-foreground')).toBe(true);
    expect(button.classList.contains('transition-all')).toBe(false);
    fireEvent.click(button);
    expect(remove).not.toHaveBeenCalled();
  });

  it('retains dialog semantics and its translated close action on the floating surface', () => {
    render(<Dialog><DialogTrigger>Open preferences</DialogTrigger><DialogContent position="tauriTall"><DialogTitle>Preferences</DialogTitle><DialogDescription>Application preferences</DialogDescription></DialogContent></Dialog>);
    fireEvent.click(screen.getByRole('button', { name: 'Open preferences' }));
    const dialog = screen.getByRole('dialog', { name: 'Preferences' });
    expect(dialog.classList.contains('bg-popover')).toBe(true);
    expect(dialog.classList.contains('rounded-xl')).toBe(true);
    expect(dialog.classList.contains('h-[85vh]')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
