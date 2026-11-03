import type { IClipboardProvider } from '@xterm/addon-clipboard';
import { writeClipboardText } from '@/lib/clipboard';

export function createTerminalClipboardProvider(onWriteError: () => void): IClipboardProvider {
  let lastErrorAt = -Infinity;

  return {
    // OSC 52 queries must never disclose the local clipboard to a remote program.
    readText: () => '',
    async writeText(selection, text) {
      // macOS has one text clipboard. Support the default and common X11 targets,
      // including lists such as "pc", but do not treat numbered cut buffers as it.
      if (!/^[cps]*$/.test(selection)) return;

      try {
        await writeClipboardText(text);
      } catch {
        // Never reject an async parser handler: a failed copy must not interrupt
        // terminal output. Also avoid flooding notifications during repeated copies.
        const now = Date.now();
        if (now - lastErrorAt >= 5000) {
          lastErrorAt = now;
          onWriteError();
        }
      }
    },
  };
}
