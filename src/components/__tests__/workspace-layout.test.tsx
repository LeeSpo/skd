import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceLayout } from '@/components/workspace-layout';
import { inspectorSizing } from '@/lib/inspector-sizing';
import { LayoutProvider } from '@/lib/layout-context';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('ResizeObserver', class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

function renderWorkspace(savedRightSize: number, inspector?: ReactNode) {
  window.innerWidth = 1280;
  localStorage.setItem('skd-layout-config', JSON.stringify({
    leftSidebarVisible: true,
    leftSidebarSize: 18,
    rightSidebarVisible: true,
    rightSidebarSize: savedRightSize,
    bottomPanelVisible: false,
    bottomPanelSize: 30,
    zenMode: false,
  }));
  return render(
    <LayoutProvider>
      <WorkspaceLayout sidebar={<div />} toolbar={<div />} inspector={inspector}>
        <div>Terminal</div>
      </WorkspaceLayout>
    </LayoutProvider>,
  );
}

it('opens the inspector inside the 280–420px band', () => {
  renderWorkspace(20, <div>Monitor</div>);
  const panel = document.getElementById('right-sidebar');
  expect(panel).not.toBeNull();
  const mainColumn = 1280 * 82 / 100;
  const expected = inspectorSizing(mainColumn, 20, 82);
  const flexGrow = Number(panel?.style.flexGrow);
  expect(flexGrow).toBeCloseTo(expected.size, 0);
  const pixels = mainColumn * flexGrow / 100;
  expect(pixels).toBeGreaterThanOrEqual(279);
  expect(pixels).toBeLessThanOrEqual(421);
});

it('clamps a saved inspector that is wider than 420px', () => {
  renderWorkspace(60, <div>Monitor</div>);
  const panel = document.getElementById('right-sidebar');
  const mainColumn = 1280 * 82 / 100;
  const pixels = mainColumn * Number(panel?.style.flexGrow) / 100;
  expect(pixels).toBeGreaterThanOrEqual(279);
  expect(pixels).toBeLessThanOrEqual(421);
});

it('leaves the main column full width while the inspector is closed', () => {
  renderWorkspace(20);
  expect(document.getElementById('right-sidebar')).toBeNull();
  const content = document.getElementById('workspace-content');
  expect(content).not.toBeNull();
  expect(Number(content?.style.flexGrow)).toBeGreaterThanOrEqual(1);
});
