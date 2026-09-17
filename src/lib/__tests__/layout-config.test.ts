import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LayoutManager, type LayoutConfig } from '../layout-config';

const key = 'skd-layout-config';
const saved: LayoutConfig = {
  leftSidebarVisible: false, leftSidebarSize: 24,
  rightSidebarVisible: true, rightSidebarSize: 27,
  bottomPanelVisible: true, bottomPanelSize: 42, zenMode: false,
};

beforeEach(() => localStorage.clear());

describe('LayoutManager quiet default', () => {
  it('starts with connections and terminal only without writing storage', () => {
    expect(LayoutManager.loadLayout()).toMatchObject({
      leftSidebarVisible: true, rightSidebarVisible: false, bottomPanelVisible: false, zenMode: false,
    });
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('preserves all saved visibility and size preferences', () => {
    const serialized = JSON.stringify(saved);
    localStorage.setItem(key, serialized);
    expect(LayoutManager.loadLayout()).toEqual(saved);
    expect(localStorage.getItem(key)).toBe(serialized);
  });

  it('retains explicitly saved values when filling missing properties', () => {
    localStorage.setItem(key, JSON.stringify({ rightSidebarVisible: true, bottomPanelSize: 45 }));
    expect(LayoutManager.loadLayout()).toMatchObject({
      leftSidebarVisible: true, rightSidebarVisible: true, bottomPanelVisible: false, bottomPanelSize: 45,
    });
  });

  it('falls back to the quiet default if stored JSON is broken', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      localStorage.setItem(key, '{');
      expect(LayoutManager.loadLayout().bottomPanelVisible).toBe(false);
      expect(log).toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it('keeps the full workspace available and resets only on request', () => {
    expect(LayoutManager.applyPreset('Full Stack')).toMatchObject({
      leftSidebarVisible: true, rightSidebarVisible: true, bottomPanelVisible: true,
    });
    expect(LayoutManager.loadLayout().bottomPanelVisible).toBe(true);
    expect(LayoutManager.resetLayout()).toMatchObject({
      leftSidebarVisible: true, rightSidebarVisible: false, bottomPanelVisible: false,
    });
    expect(localStorage.getItem(key)).toBeNull();
  });
});
