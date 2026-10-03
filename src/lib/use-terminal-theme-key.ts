import { useEffect, useState } from 'react';

/** Increment whenever the root theme class, palette or accent colour changes so terminals update in place. */
export function useTerminalThemeKey(): number {
  const [themeKey, setThemeKey] = useState(0);

  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        // `style` carries --system-accent, the only root-level inline style.
        if (
          mutation.attributeName === 'class'
          || mutation.attributeName === 'data-color-palette'
          || mutation.attributeName === 'data-native-material'
          || mutation.attributeName === 'data-reduce-transparency'
          || mutation.attributeName === 'style'
        ) {
          setThemeKey((key) => key + 1);
          break;
        }
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-color-palette', 'data-native-material', 'data-reduce-transparency', 'style'],
    });

    return () => observer.disconnect();
  }, []);

  return themeKey;
}
