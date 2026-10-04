import { expect, it } from 'vitest';
import { inspectorSizing } from '@/lib/inspector-sizing';

it('clamps a wide column to 420px', () => {
  const width = 1600;
  const sizing = inspectorSizing(width, 50, 80);
  expect(width * sizing.size / 100).toBeCloseTo(420);
  expect(width * sizing.maxSize / 100).toBeCloseTo(420);
  expect(sizing.maxSize).toBeLessThanOrEqual(50);
});

it('raises a narrow saved width to 280px when that stays under 40%', () => {
  const width = 1000;
  const sizing = inspectorSizing(width, 5, 80);
  expect(width * sizing.size / 100).toBeCloseTo(280);
  expect(sizing.minSize).toBeCloseTo(28);
});

it('caps the floor at 40% when 280px would swallow the terminal', () => {
  const sizing = inspectorSizing(500, 5, 80);
  expect(sizing.minSize).toBe(40);
  expect(sizing.size).toBe(40);
  expect(sizing.maxSize).toBe(50);
});

it('keeps a saved proportion that already sits inside the pixel band', () => {
  const width = 1200;
  const savedPixels = 320;
  const workspaceShare = 80;
  const savedWindowPercent = savedPixels / width * workspaceShare;
  const sizing = inspectorSizing(width, savedWindowPercent, workspaceShare);
  expect(width * sizing.size / 100).toBeCloseTo(savedPixels);
});

it('stays finite when the column width or saved size cannot be used', () => {
  for (const sizing of [
    inspectorSizing(0, 20, 82),
    inspectorSizing(Number.NaN, 20, 80),
    inspectorSizing(1000, Number.NaN, 0),
    inspectorSizing(-20, -5, -1),
  ]) {
    expect(Number.isFinite(sizing.minSize)).toBe(true);
    expect(Number.isFinite(sizing.size)).toBe(true);
    expect(Number.isFinite(sizing.maxSize)).toBe(true);
    expect(sizing.minSize).toBeLessThanOrEqual(sizing.size);
    expect(sizing.size).toBeLessThanOrEqual(sizing.maxSize);
    expect(sizing.maxSize).toBeLessThanOrEqual(50);
  }
});
