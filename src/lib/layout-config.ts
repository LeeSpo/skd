/**
 * Layout Configuration and Management
 * Provides VS Code-like layout functionality
 */

export interface LayoutConfig {
  leftSidebarVisible: boolean;
  leftSidebarSize: number;
  rightSidebarVisible: boolean;
  rightSidebarSize: number;
  bottomPanelVisible: boolean;
  bottomPanelSize: number;
  zenMode: boolean;
}

const DEFAULT_LAYOUT: LayoutConfig = {
  leftSidebarVisible: true,
  leftSidebarSize: 18,
  rightSidebarVisible: false,
  rightSidebarSize: 20,
  bottomPanelVisible: false,
  bottomPanelSize: 30,
  zenMode: false,
};

const LAYOUT_STORAGE_KEY = 'skd-layout-config';

export class LayoutManager {
  /**
   * Load layout configuration from localStorage
   */
  static loadLayout(): LayoutConfig {
    try {
      const stored = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (stored) {
        const config = JSON.parse(stored);
        return { ...DEFAULT_LAYOUT, ...config };
      }
    } catch (error) {
      console.error('Failed to load layout config:', error);
    }
    return DEFAULT_LAYOUT;
  }

  /**
   * Save layout configuration to localStorage
   */
  static saveLayout(config: LayoutConfig): void {
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(config));
    } catch (error) {
      console.error('Failed to save layout config:', error);
    }
  }

  /**
   * Reset layout to default
   */
  static resetLayout(): LayoutConfig {
    localStorage.removeItem(LAYOUT_STORAGE_KEY);
    return DEFAULT_LAYOUT;
  }
}
