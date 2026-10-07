import { useTranslation } from 'react-i18next';
import {
  getThemeAwareTerminalTheme,
  terminalBackgroundSize,
  terminalContainerBackground,
  type TerminalAppearanceSettings,
} from '@/lib/terminal-config';
import { useTerminalThemeKey } from '@/lib/use-terminal-theme-key';
import { useBlocksTerminalTransparency } from '@/lib/use-window-appearance';

export function TerminalAppearancePreview({ appearance }: { appearance: TerminalAppearanceSettings }) {
  const { t } = useTranslation();
  useTerminalThemeKey();
  const transparencyBlocked = useBlocksTerminalTransparency();
  const theme = getThemeAwareTerminalTheme(appearance);

  return (
    <div className="rounded-lg bg-muted p-3">
      <div
        role="img"
        aria-label={t('settings.appearance.preview')}
        className="relative overflow-hidden rounded p-3 font-mono text-sm"
        style={{
          fontFamily: appearance.fontFamily,
          fontSize: `${appearance.fontSize}px`,
          lineHeight: appearance.lineHeight,
          letterSpacing: `${appearance.letterSpacing}px`,
          backgroundColor: terminalContainerBackground({
            allowTransparency: appearance.allowTransparency && !transparencyBlocked,
            nativeMaterial: document.documentElement.dataset.nativeMaterial === 'true',
            opacity: appearance.opacity,
            opaqueBackground: theme.background ?? '#1e1e1e',
          }),
          color: theme.foreground,
        }}
      >
        {appearance.backgroundImage && (
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: `url(${appearance.backgroundImage})`,
              backgroundSize: terminalBackgroundSize(appearance.backgroundImagePosition),
              backgroundPosition: 'center',
              backgroundRepeat: appearance.backgroundImagePosition === 'tile' ? 'repeat' : 'no-repeat',
              opacity: appearance.backgroundImageOpacity / 100,
              filter: appearance.backgroundImageBlur > 0 ? `blur(${appearance.backgroundImageBlur}px)` : 'none',
            }}
          />
        )}
        <div className="relative z-10">
          <div style={{ color: theme.green }}>user@host</div>
          <div>$ ls -la</div>
          <div style={{ color: theme.blue }}>drwxr-xr-x</div>
          <div style={{ color: theme.yellow }}>-rw-r--r--</div>
        </div>
      </div>
    </div>
  );
}
