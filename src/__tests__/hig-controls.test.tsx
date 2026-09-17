import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue } from '@/components/ui/select';

afterEach(cleanup);

// App-specific class contracts, not measured contrast or native HIG compliance.
function expectSemanticFocus(control: HTMLElement) {
  expect(control.classList.contains('focus-visible:ring-ring')).toBe(true);
  expect(control.classList.contains('focus-visible:ring-[3px]')).toBe(true);
  expect(control.classList.contains('focus-visible:border-ring')).toBe(true);
  expect(control.className).not.toMatch(/ring-ring\/|ring-destructive/);
}

describe('shared control focus and density', () => {
  it.each([false, true])('keeps field focus semantic when aria-invalid=%s', (invalid) => {
    render(<>
      <Input aria-label="Host" aria-invalid={invalid} />
      <Textarea aria-label="Command" aria-invalid={invalid} />
      <Select><SelectTrigger aria-label="Protocol" aria-invalid={invalid}><SelectValue placeholder="Choose" /></SelectTrigger></Select>
    </>);
    const input = screen.getByRole('textbox', { name: 'Host' });
    const textarea = screen.getByRole('textbox', { name: 'Command' });
    const select = screen.getByRole('combobox', { name: 'Protocol' });
    for (const field of [input, textarea, select]) {
      expectSemanticFocus(field);
      expect(field.getAttribute('aria-invalid')).toBe(String(invalid));
      expect(field.classList.contains('aria-invalid:border-destructive')).toBe(true);
      expect(field.classList.contains('bg-input-background')).toBe(true);
      expect(field.classList.contains('rounded-md')).toBe(true);
      expect(field.classList.contains('text-[13px]')).toBe(true);
    }
    expect(input.classList.contains('h-9')).toBe(true);
    expect(textarea.classList.contains('min-h-16')).toBe(true);
    expect(select.getAttribute('data-size')).toBe('default');
    expect(select.classList.contains('data-[size=default]:h-9')).toBe(true);
  });

  it.each(['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'] as const)(
    'uses the same focus color for %s buttons, independently of errors', (variant) => {
      render(<Button variant={variant} aria-invalid>Action</Button>);
      const button = screen.getByRole('button', { name: 'Action' });
      expectSemanticFocus(button);
      expect(button.classList.contains('aria-invalid:border-destructive')).toBe(true);
      expect(button.classList.contains('rounded-md')).toBe(true);
      expect(button.classList.contains('text-[13px]')).toBe(true);
    },
  );

  it.each([
    ['default', 'h-9'], ['sm', 'h-8'], ['lg', 'h-10'],
    ['icon', 'size-9'], ['toolbar', 'size-6'], ['menubar', 'size-7'],
  ] as const)('preserves the %s button size rather than imposing one height', (size, density) => {
    render(<Button size={size}>Action</Button>);
    expect(screen.getByRole('button', { name: 'Action' }).classList.contains(density)).toBe(true);
  });

  it('retains compact select sizing and disabled semantics', () => {
    render(<Select disabled><SelectTrigger size="sm" aria-label="Protocol"><SelectValue placeholder="Choose" /></SelectTrigger></Select>);
    const select = screen.getByRole('combobox', { name: 'Protocol' }) as HTMLButtonElement;
    expect(select.getAttribute('data-size')).toBe('sm');
    expect(select.classList.contains('data-[size=sm]:h-8')).toBe(true);
    expect(select.disabled).toBe(true);
  });

  it('preserves input callbacks, secure entry, button actions, and caller overrides', () => {
    const change = vi.fn();
    const click = vi.fn();
    render(<>
      <Input type="password" aria-label="Password" onChange={change} className="h-8 rounded-sm" />
      <Textarea aria-label="Command" onChange={change} />
      <Button onClick={click}>Run</Button>
      <Button disabled onClick={click}>Unavailable</Button>
    </>);
    const password = screen.getByLabelText('Password') as HTMLInputElement;
    expect(password.type).toBe('password');
    expect(password.classList.contains('h-8')).toBe(true);
    expect(password.classList.contains('rounded-sm')).toBe(true);
    expect(password.classList.contains('h-9')).toBe(false);
    expect(password.classList.contains('rounded-md')).toBe(false);
    fireEvent.change(password, { target: { value: 'example' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Command' }), { target: { value: 'pwd' } });
    expect(change).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unavailable' }));
    expect(click).toHaveBeenCalledOnce();
  });
});
