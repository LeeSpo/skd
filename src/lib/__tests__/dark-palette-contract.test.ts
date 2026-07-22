import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf8');

const expectedCore = {
  graphite: {
    background: '#11141a',
    card: '#171b23',
    popover: '#1d232d',
    'input-background': '#13171e',
    'surface-hover': '#222a35',
    'surface-selected': '#243652',
    border: '#2b3442',
    foreground: '#e7ecf4',
    'muted-foreground': '#929cac',
    primary: '#5b8ff9',
  },
  midnight: {
    background: '#07101f',
    card: '#0d1728',
    popover: '#14223a',
    'input-background': '#091322',
    'surface-hover': '#182a46',
    'surface-selected': '#1b345a',
    border: '#253a59',
    foreground: '#e8eef8',
    'muted-foreground': '#8f9cb3',
    primary: '#6b9bfa',
  },
  nordic: {
    background: '#20262f',
    card: '#272e39',
    popover: '#303947',
    'input-background': '#232a34',
    'surface-hover': '#374251',
    'surface-selected': '#354c5b',
    border: '#465364',
    foreground: '#eceff4',
    'muted-foreground': '#a4aebc',
    primary: '#88c0d0',
  },
} as const;

const requiredVariables = [
  'background',
  'foreground',
  'card',
  'popover',
  'primary',
  'muted-foreground',
  'border',
  'input-background',
  'surface-raised',
  'surface-selected',
  'surface-hover',
  'workspace-bg',
  'statusbar-bg',
  'terminal-bg',
  'overlay',
  'scrollbar-thumb',
  'scrollbar-thumb-hover',
] as const;

function paletteVariables(palette: keyof typeof expectedCore): Record<string, string> {
  const block = css.match(
    new RegExp(`\\.dark\\[data-color-palette="${palette}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`),
  )?.[1];
  expect(block, `${palette} palette block`).toBeDefined();

  return Object.fromEntries(
    Array.from(block?.matchAll(/--([\w-]+):\s*([^;]+);/g) ?? [], (match) => [
      match[1],
      match[2].trim().toLowerCase(),
    ]),
  );
}

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/../g)?.map((channel) => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  if (!channels || channels.length !== 3) throw new Error(`Expected a six-digit hex colour, got ${hex}`);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05)
    / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

describe('dark workspace palette contract', () => {
  for (const palette of Object.keys(expectedCore) as Array<keyof typeof expectedCore>) {
    it(`${palette} defines the agreed semantic hierarchy`, () => {
      const variables = paletteVariables(palette);
      for (const variable of requiredVariables) {
        expect(variables[variable], `${palette} --${variable}`).toBeDefined();
      }
      expect(variables).toMatchObject(expectedCore[palette]);
    });

    it(`${palette} keeps text, focus and state contrast accessible`, () => {
      const variables = paletteVariables(palette);
      expect(contrastRatio(variables.foreground, variables.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(variables['muted-foreground'], variables.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(variables.primary, variables.background)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(variables['surface-selected'], variables.background)).toBeGreaterThanOrEqual(1.4);
      expect(contrastRatio(variables['surface-hover'], variables.background)).toBeGreaterThanOrEqual(1.2);
    });
  }
});
