import { useLayoutEffect, useRef, useState } from 'react';

export function bottomPanelSizing(height: number, savedSize: number) {
  const minSize = Math.min(50, 240 / Math.max(1, height) * 100);
  const size = Math.min(50, Math.max(minSize, Number.isFinite(savedSize) ? savedSize : 30));
  return { minSize, maxSize: 50, size };
}

/** Measure the existing content surface without moving the terminal subtree. */
export function useBottomPanelSizing(savedSize: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(() => Math.max(1, window.innerHeight - 44));
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = (next: number) => { if (next > 0) setHeight(next); };
    update(element.getBoundingClientRect().height);
    const observer = new ResizeObserver(([entry]) => update(entry.contentRect.height));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, ...bottomPanelSizing(height, savedSize) };
}
