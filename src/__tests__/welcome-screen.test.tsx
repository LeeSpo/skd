import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WelcomeScreen } from '@/components/welcome-screen';

afterEach(cleanup);

it('offers only functional native-button actions without decorative gradients', () => {
  const connect = vi.fn();
  const settings = vi.fn();
  const local = vi.fn();
  const { container } = render(<WelcomeScreen onNewConnection={connect} onNewLocalTerminal={local} onOpenSettings={settings} />);
  expect(screen.getAllByRole('button')).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: /connect to a server/i }));
  fireEvent.click(screen.getByRole('button', { name: /preferences/i }));
  fireEvent.click(screen.getByRole('button', { name: /open a local terminal/i }));
  expect(connect).toHaveBeenCalledOnce();
  expect(settings).toHaveBeenCalledOnce();
  expect(local).toHaveBeenCalledOnce();
  expect(screen.queryByRole('heading', { name: 'Recent' })).toBeNull();
});

it('lists recent connections and hides that column when the list is empty', () => {
  const connect = vi.fn();
  render(
    <WelcomeScreen
      onNewConnection={vi.fn()}
      onOpenSettings={vi.fn()}
      onQuickConnect={connect}
      recentConnections={[{ id: 'db', name: 'prod-api', host: 'db.example', username: 'root' }]}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /prod-api/i }));
  expect(connect).toHaveBeenCalledWith('db');
});
