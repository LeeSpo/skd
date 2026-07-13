import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  clearTabDrag,
  getActiveDrag,
  getContentDropHover,
  setActiveDrag,
  setContentDropHover,
  subscribeTabDrag,
  registerContentDropTarget,
  unregisterContentDropTarget,
  findContentDropTargetAt,
} from '../tab-drag-state';

describe('tab-drag-state', () => {
  beforeEach(() => {
    clearTabDrag();
  });

  it('notifies subscribers when active drag changes', () => {
    const listener = vi.fn();
    const unsub = subscribeTabDrag(listener);

    setActiveDrag({ tabId: 't1', sourceGroupId: '1', tabName: 'Host' });
    expect(listener).toHaveBeenCalled();
    expect(getActiveDrag()?.tabId).toBe('t1');

    clearTabDrag();
    expect(getActiveDrag()).toBeNull();
    expect(getContentDropHover()).toBeNull();

    unsub();
  });

  it('skips notify when content hover is unchanged', () => {
    const listener = vi.fn();
    const unsub = subscribeTabDrag(listener);

    setContentDropHover({ groupId: '1', zone: 'right' });
    const callsAfterFirst = listener.mock.calls.length;

    setContentDropHover({ groupId: '1', zone: 'right' });
    expect(listener.mock.calls.length).toBe(callsAfterFirst);

    setContentDropHover({ groupId: '1', zone: 'left' });
    expect(listener.mock.calls.length).toBeGreaterThan(callsAfterFirst);

    unsub();
  });

  it('findContentDropTargetAt uses registered element rects', () => {
    const el = document.createElement('div');
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 100,
      width: 200,
      height: 200,
      right: 300,
      bottom: 300,
      x: 100,
      y: 100,
      toJSON: () => {},
    });

    registerContentDropTarget('g1', el);
    expect(findContentDropTargetAt(150, 150)?.groupId).toBe('g1');
    expect(findContentDropTargetAt(10, 10)).toBeNull();
    unregisterContentDropTarget('g1');
  });
});
