import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusBar } from '../components/status-bar';

afterEach(cleanup);

const conn = {
  name: 'Production',
  protocol: 'SSH',
  host: 'example.test',
  status: 'connected' as const,
};

describe('StatusBar', () => {
  it('shows status, merged host info, and protocol without filler text', () => {
    render(<StatusBar activeConnection={conn} />);
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.getByText('Production — example.test').getAttribute('title')).toBe('Production — example.test');
    expect(screen.getByText('SSH')).toBeTruthy();
    expect(screen.queryByText('Ready')).toBeNull();
  });

  it('marks pending as waiting instead of disconnected, and renders an idle bar cleanly', () => {
    const { rerender } = render(<StatusBar activeConnection={{ ...conn, status: 'pending' }} />);
    expect(screen.getByText('Waiting to connect')).toBeTruthy();

    rerender(<StatusBar />);
    expect(screen.queryByText('Ready')).toBeNull();
    expect(screen.queryByText('SSH')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
