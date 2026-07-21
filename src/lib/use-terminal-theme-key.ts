import { useEffect, useState } from 'react';

/** Increment whenever the root theme class changes so terminals update in place. */
export function useTerminalThemeKey(): number {
  const [themeKey, setThemeKey] = useState(0);

  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === 'class') {
          setThemeKey((key) => key + 1);
          break;
        }
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => observer.disconnect();
  }, []);

  return themeKey;
}
