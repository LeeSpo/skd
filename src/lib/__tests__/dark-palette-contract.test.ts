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
    'muted-foreground': '#98a2b2',
    primary: '#5b8ff9',
  },
  midnight: {
    background: '#10151e',
    card: '#181f2b',
    popover: '#232d3b',
    'input-background': '#131b26',
    'surface-hover': '#283445',
    'surface-selected': '#2a3e59',
    border: '#3e4b5e',
    foreground: '#e8eef8',
    'muted-foreground': '#a8b2c2',
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
    'muted-foreground': '#b2bcc9',
    primary: '#88c0d0',
  },
  cupertino: {
    background: '#1c1c1e',
    card: '#242426',
    popover: '#2c2c2e',
    'input-background': '#202022',
    'surface-hover': '#343437',
    'surface-selected': '#163d66',
    border: '#48484a',
    foreground: '#f5f5f7',
    'muted-foreground': '#b0b0b8',
    primary: '#0a84ff',
  },
} as const;

const expectedCupertinoLight = {
  background: '#f5f5f7',
  card: '#ffffff',
  popover: '#ffffff',
  'input-background': '#ffffff',
  'surface-hover': '#e8e8ed',
  'surface-selected': '#c8e0ff',
  border: '#d2d2d7',
  foreground: '#1d1d1f',
  'muted-foreground': '#56565c',
  primary: '#0066cc',
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

function cupertinoLightVariables(): Record<string, string> {
  const block = css.match(
    /\[data-color-palette="cupertino"\]\s*\{([\s\S]*?)\n\}/,
  )?.[1];
  expect(block, 'Cupertino light palette block').toBeDefined();

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
  it('Graphite keeps supporting text readable on the selected surface', () => {
    const variables = paletteVariables('graphite');
    expect(contrastRatio(variables['muted-foreground'], variables['surface-selected']))
      .toBeGreaterThanOrEqual(4.5);
  });

  it('Midnight keeps supporting text readable on elevated and selected surfaces', () => {
    const variables = paletteVariables('midnight');
    for (const surface of ['popover', 'surface-selected', 'surface-hover']) {
      expect(contrastRatio(variables['muted-foreground'], variables[surface])).toBeGreaterThanOrEqual(4.5);
    }
    expect(luminance(variables.background)).toBeLessThan(luminance(variables.card));
    expect(luminance(variables.card)).toBeLessThan(luminance(variables.popover));
    expect(variables['terminal-bg']).toBe('#050b16');
  });

  it('light keeps supporting and semantic text readable on workspace surfaces', () => {
    const block = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const variables = Object.fromEntries(Array.from(
      block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/g), (match) => [match[1], match[2]],
    ));
    for (const text of ['foreground', 'muted-foreground', 'success', 'warning', 'destructive']) {
      for (const surface of ['background', 'card', 'popover', 'surface-selected', 'surface-hover']) {
        expect(contrastRatio(variables[text], variables[surface]), `${text} on ${surface}`)
          .toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const state of ['success', 'warning', 'destructive']) {
      expect(contrastRatio(variables[state], variables[`${state}-foreground`])).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('Cupertino defines a complete, readable light appearance', () => {
    const variables = cupertinoLightVariables();
    for (const variable of requiredVariables) {
      expect(variables[variable], `Cupertino light --${variable}`).toBeDefined();
    }
    expect(variables).toMatchObject(expectedCupertinoLight);

    for (const text of ['foreground', 'muted-foreground', 'success', 'warning', 'destructive']) {
      for (const surface of ['background', 'card', 'popover', 'surface-selected', 'surface-hover']) {
        expect(contrastRatio(variables[text], variables[surface]), `Cupertino light ${text} on ${surface}`)
          .toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const state of ['primary', 'success', 'warning', 'destructive']) {
      expect(contrastRatio(variables[state], variables[`${state}-foreground`]))
        .toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(variables.primary, variables.background)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(variables['surface-selected'], variables.background)).toBeGreaterThanOrEqual(1.2);
  });

  for (const palette of Object.keys(expectedCore) as Array<keyof typeof expectedCore>) {
    it(`${palette} keeps semantic text readable on workspace surfaces and filled controls`, () => {
      const variables = paletteVariables(palette);
      for (const state of ['success', 'warning', 'destructive']) {
        for (const surface of ['background', 'card', 'popover', 'surface-selected', 'surface-hover']) {
          expect(contrastRatio(variables[state], variables[surface]), `${palette} ${state} on ${surface}`)
            .toBeGreaterThanOrEqual(4.5);
        }
        expect(contrastRatio(variables[state], variables[`${state}-foreground`]))
          .toBeGreaterThanOrEqual(4.5);
      }
    });

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
      for (const surface of ['background', 'card', 'popover', 'surface-selected', 'surface-hover']) {
        expect(contrastRatio(variables['muted-foreground'], variables[surface]), `${palette} on ${surface}`)
          .toBeGreaterThanOrEqual(4.5);
      }
      expect(contrastRatio(variables.primary, variables.background)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(variables['surface-selected'], variables.background)).toBeGreaterThanOrEqual(1.4);
      expect(contrastRatio(variables['surface-hover'], variables.background)).toBeGreaterThanOrEqual(1.2);
    });
  }
});
