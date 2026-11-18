/** WebKit emits this non-character keydown when CapsLock commits a Pinyin composition. */
export function shouldIgnoreImeKeyDown(
  event: Pick<KeyboardEvent, 'type' | 'isComposing' | 'keyCode' | 'key'>,
): boolean {
  return event.type === 'keydown'
    && event.isComposing
    && event.keyCode === 0
    && event.key === 'Unidentified';
}

interface PendingComposition {
  prefix: string;
  letters: string;
  capsLock: boolean;
  committedText: string | null;
}

export function bindTerminalIme(textarea: HTMLTextAreaElement): () => void {
  let pending: PendingComposition | null = null;

  const start = () => {
    pending = { prefix: textarea.value, letters: '', capsLock: false, committedText: null };
  };
  const reset = () => { pending = null; };

  const keydown = (event: KeyboardEvent) => {
    if (!pending) return;
    if (event.isComposing && event.key === 'CapsLock' && event.keyCode === 20) {
      pending.capsLock = true;
      return;
    }
    if (pending.capsLock && shouldIgnoreImeKeyDown(event)) return;

    // WebKit exposes the original letter even when Pinyin has already updated the marked text.
    if (!pending.capsLock && event.isComposing && event.keyCode === 229
      && !event.ctrlKey && !event.metaKey && !event.altKey && /^[a-z]$/i.test(event.key)) {
      pending.letters += event.key;
    } else {
      // A real space, navigation, or an edit makes the raw-letter comparison ambiguous.
      reset();
    }
  };

  const input = (event: Event) => {
    if (!pending?.capsLock || !(event instanceof InputEvent)) return;
    pending.committedText = event.inputType === 'insertFromComposition' ? event.data : null;
  };

  const end = (event: CompositionEvent) => {
    const composition = pending;
    reset();
    if (!composition?.capsLock) return;
    const { data } = event;
    const { committedText, letters, prefix } = composition;
    if (data !== committedText || !/^[a-z]+(?: [a-z]+)+$/i.test(data)
      || data.replace(/ /g, '') !== letters || textarea.value !== prefix + data) return;

    // The native commit is in the textarea now. xterm reads this suffix after compositionend.
    textarea.value = prefix + letters;
  };

  textarea.addEventListener('compositionstart', start, true);
  textarea.addEventListener('keydown', keydown, true);
  textarea.addEventListener('input', input, true);
  textarea.addEventListener('compositionend', end, true);
  textarea.addEventListener('blur', reset);
  return () => {
    textarea.removeEventListener('compositionstart', start, true);
    textarea.removeEventListener('keydown', keydown, true);
    textarea.removeEventListener('input', input, true);
    textarea.removeEventListener('compositionend', end, true);
    textarea.removeEventListener('blur', reset);
    reset();
  };
}
