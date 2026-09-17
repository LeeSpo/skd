import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WelcomeScreen } from '@/components/welcome-screen';

afterEach(cleanup);

it('offers only functional native-button actions without decorative gradients', () => {
  const connect = vi.fn();
  const settings = vi.fn();
  const { container } = render(<WelcomeScreen onNewConnection={connect} onOpenSettings={settings} />);
  expect(screen.getAllByRole('button')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: /new connection/i }));
  fireEvent.click(screen.getByRole('button', { name: /preferences/i }));
  expect(connect).toHaveBeenCalledOnce();
  expect(settings).toHaveBeenCalledOnce();
  expect(container.querySelector('[class*="gradient"]')).toBeNull();
});
