import { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useDialogPresence } from '@/lib/use-dialog-presence';

function DialogHarness({
  open,
  captureClose,
}: {
  open: boolean;
  captureClose: (onClosed: () => void) => void;
}) {
  const { present, onClosed } = useDialogPresence(open);
  useEffect(() => captureClose(onClosed), [captureClose, onClosed]);
  return present ? <input aria-label="Draft" defaultValue="" /> : null;
}

describe('lazy dialog presence', () => {
  afterEach(cleanup);

  it('keeps the outgoing form until close completes, then opens a fresh form', () => {
    let onClosed = () => {};
    const captureClose = (callback: () => void) => { onClosed = callback; };
    const { rerender } = render(<DialogHarness open={false} captureClose={captureClose} />);
    expect(screen.queryByRole('textbox')).toBeNull();

    rerender(<DialogHarness open captureClose={captureClose} />);
    const draft = screen.getByRole('textbox');
    fireEvent.change(draft, { target: { value: 'Unsaved connection' } });

    rerender(<DialogHarness open={false} captureClose={captureClose} />);
    expect(screen.getByRole('textbox')).toBe(draft);
    expect(draft).toHaveProperty('value', 'Unsaved connection');

    act(() => onClosed());
    expect(screen.queryByRole('textbox')).toBeNull();

    rerender(<DialogHarness open captureClose={captureClose} />);
    expect(screen.getByRole('textbox')).toHaveProperty('value', '');
  });

  it('preserves the form when reopening races a previous close callback', () => {
    let onClosed = () => {};
    const captureClose = (callback: () => void) => { onClosed = callback; };
    const { rerender } = render(<DialogHarness open captureClose={captureClose} />);
    const draft = screen.getByRole('textbox');
    fireEvent.change(draft, { target: { value: 'Still editing' } });

    rerender(<DialogHarness open={false} captureClose={captureClose} />);
    const previousClose = onClosed;
    rerender(<DialogHarness open captureClose={captureClose} />);
    act(() => previousClose());
    expect(screen.getByRole('textbox')).toBe(draft);
    expect(draft).toHaveProperty('value', 'Still editing');

    rerender(<DialogHarness open={false} captureClose={captureClose} />);
    act(() => onClosed());
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
