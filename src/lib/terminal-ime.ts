/** WebKit emits this non-character keydown when CapsLock commits a Pinyin composition. */
export function shouldIgnoreImeKeyDown(
  event: Pick<KeyboardEvent, 'type' | 'isComposing' | 'keyCode' | 'key'>,
): boolean {
  return event.type === 'keydown'
    && event.isComposing
    && event.keyCode === 0
    && event.key === 'Unidentified';
}
