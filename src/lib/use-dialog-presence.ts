import { useCallback, useState } from 'react';

/** Keep lazy dialogs mounted until Radix finishes closing and restores focus. */
export function useDialogPresence(open: boolean) {
  const [present, setPresent] = useState(open);

  // Latch during render so a rapid reopen never waits for an effect to mount.
  if (open && !present) setPresent(true);

  const onClosed = useCallback(() => {
    if (!open) setPresent(false);
  }, [open]);

  return { present: open || present, onClosed };
}
