import { expect, it } from 'vitest';
import { bottomPanelSizing } from '@/lib/use-bottom-panel-sizing';

it('clamps saved percentages to a 240px minimum using the workspace height', () => {
  for (const height of [556, 756, 1000]) {
    const sizing = bottomPanelSizing(height, 20);
    expect(height * sizing.size / 100).toBeCloseTo(240);
  }
  expect(bottomPanelSizing(1000, 40).size).toBe(40);
  expect(bottomPanelSizing(556, 90).size).toBe(50);
  expect(bottomPanelSizing(0, 30).minSize).toBe(50);
});
