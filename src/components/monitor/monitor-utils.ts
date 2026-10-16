export const getUsageColor = (usage: number): string => {
  if (usage >= 90) return 'text-destructive';
  if (usage >= 75) return 'text-warning';
  if (usage >= 50) return 'text-warning';
  return 'text-foreground';
};

export const getProgressColor = (usage: number): string => {
  if (usage >= 90) return '[&>div]:bg-destructive';
  if (usage >= 75) return '[&>div]:bg-warning';
  if (usage >= 50) return '[&>div]:bg-warning';
  return '[&>div]:bg-muted-foreground';
};

export const getGpuTempColor = (temp: number): string => {
  if (temp >= 85) return 'text-destructive';
  if (temp >= 75) return 'text-warning';
  if (temp >= 60) return 'text-warning';
  return 'text-foreground';
};

const GPU_COLORS = ['var(--monitor-trend-primary)', 'var(--chart-5)', 'var(--foreground)'];
const GPU_LINE_PATTERNS = [undefined, '4 3', '2 3', '8 3', '8 3 2 3'];

export function getGpuTrendStyle(index: number): { color: string; dash?: string } {
  return {
    color: GPU_COLORS[index % GPU_COLORS.length],
    dash: GPU_LINE_PATTERNS[index % GPU_LINE_PATTERNS.length],
  };
}

export function scheduleIdleTask(task: () => void): void {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(task);
  } else {
    task();
  }
}
