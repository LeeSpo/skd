import { useEffect, useState, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { withRetry, CancelledError } from '@/lib/async-retry';
import { Card, CardContent } from '../ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Progress } from '../ui/progress';
import { Badge } from '../ui/badge';
import { CHART_COLORS } from '@/lib/chart-colors';
import { MonitorTrend } from './monitor-trend';
import type {
  GpuDetectionResult,
  GpuHistoryData,
  GpuStats,
  MonitorPanelProps,
} from './monitor-types';
import { getGpuTrendStyle, getGpuTempColor, getProgressColor, getUsageColor, scheduleIdleTask } from './monitor-utils';

function GpuValue({ value, temperature = false, children }: { value: number; temperature?: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  const warning = value >= (temperature ? 60 : 50);
  const critical = value >= (temperature ? 85 : 90);
  return (
    <span className={`inline-flex items-center gap-1 text-ui-body font-medium tabular-nums ${temperature ? getGpuTempColor(value) : getUsageColor(value)}`}>
      {warning && <TriangleAlert role="img" aria-label={t(critical ? 'systemMonitor.criticalUsage' : 'systemMonitor.elevatedUsage')} className="size-[1em] shrink-0" />}
      {children}
    </span>
  );
}

const formatPercent = (value: number) => `${value.toFixed(1)}%`;

export function GpuMonitorPanel({ connectionId, active = true }: MonitorPanelProps) {
  const { t } = useTranslation();
  const [gpuDetection, setGpuDetection] = useState<GpuDetectionResult | null>(null);
  const [gpuStats, setGpuStats] = useState<GpuStats[]>([]);
  const [selectedGpuIndex, setSelectedGpuIndex] = useState<number | 'all'>('all');
  const [gpuHistory, setGpuHistory] = useState<Map<number, GpuHistoryData[]>>(new Map());
  const [gpuDetectionDone, setGpuDetectionDone] = useState(false);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGpuDetectionDone(false);
    setGpuDetection(null);
    setGpuStats([]);
    setGpuHistory(new Map());

    void withRetry(
      () => invoke<GpuDetectionResult>('detect_gpu', { connectionId }),
      () => cancelled,
      {
        maxRetries: 3,
        onRetry: (n, err) => console.warn(`GPU detection retry ${n}:`, err),
      },
    ).then(result => {
      setGpuDetection(result);
      setGpuDetectionDone(true);
      if (result.available && result.gpus.length > 0) {
        setSelectedGpuIndex(result.gpus.length > 1 ? 'all' : result.gpus[0].index);
      }
    }).catch(err => {
      if (err instanceof CancelledError) return;
      console.error('GPU detection failed after all retries:', err);
      setGpuDetection({ available: false, vendor: 'unknown', gpus: [], detection_method: 'none' });
      setGpuDetectionDone(true);
    });

    return () => { cancelled = true; };
  }, [connectionId, active]);

  useEffect(() => {
    if (!active) return;
    if (!gpuDetection?.available) return;

    const fetchGpuStats = async (isCancelled: () => boolean = () => false): Promise<void> => {
      const result = await invoke<{
        success: boolean;
        gpus: GpuStats[];
        error?: string;
      }>('get_gpu_stats', { connectionId });

      if (isCancelled()) return;

      if (result.success && result.gpus.length > 0) {
        setGpuStats(result.gpus);

        const now = new Date();
        const timeStr = now.toLocaleTimeString().slice(0, 8);

        setGpuHistory(prev => {
          const newHistory = new Map(prev);
          result.gpus.forEach(gpu => {
            const history = newHistory.get(gpu.index) || [];
            const newPoint: GpuHistoryData = {
              time: timeStr,
              utilization: gpu.utilization,
              memory: gpu.memory_percent,
              temperature: gpu.temperature,
              timestamp: now.getTime(),
            };
            newHistory.set(gpu.index, [...history, newPoint].slice(-60));
          });
          return newHistory;
        });
      }
    };

    let cancelled = false;

    void fetchGpuStats(() => cancelled).catch(err => console.error('GPU stats fetch failed:', err));

    const interval = setInterval(() => {
      scheduleIdleTask(() => { void fetchGpuStats(() => cancelled).catch(() => {}); });
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [connectionId, gpuDetection?.available, active]);

  if (!gpuDetectionDone) {
    return null;
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-1.5">
        <div className="min-w-0">
          <h3 className="text-ui-body font-medium truncate">{t('systemMonitor.gpuMonitor')}</h3>
        </div>
        {gpuDetection?.available && gpuDetection.gpus.length > 1 && (
          <Select
            value={selectedGpuIndex.toString()}
            onValueChange={(value) => setSelectedGpuIndex(value === 'all' ? 'all' : parseInt(value))}
          >
            <SelectTrigger aria-label={t('systemMonitor.selectGpu')} size="sm" className="w-auto min-w-[70px] max-w-[120px] text-ui-label px-1.5 py-0">
              <SelectValue placeholder={t('systemMonitor.selectGpu')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-ui-label">
                {t('systemMonitor.allGpus')}
              </SelectItem>
              {gpuDetection.gpus.map(gpu => (
                <SelectItem key={gpu.index} value={gpu.index.toString()} className="text-ui-label">
                  GPU {gpu.index}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <Card>
        <CardContent className="p-2">
          {!gpuDetection?.available ? (
            <div className="text-ui-label text-muted-foreground space-y-1">
              <p>{t('systemMonitor.noGpuDetected')}</p>
              <p className="text-ui-label">{t('systemMonitor.supportedGpus')}</p>
            </div>
          ) : selectedGpuIndex === 'all' ? (
            <div className="space-y-2">
              {gpuStats.map(gpu => (
                <div key={gpu.index} className="border rounded p-1.5 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: getGpuTrendStyle(gpu.index).color }}
                    />
                    <span className="text-ui-label font-medium truncate">
                      GPU {gpu.index}: {gpu.name}
                    </span>
                  </div>

                  <div className="monitor-gpu-summary grid gap-2 text-ui-label">
                    <div className="space-y-0.5">
                      <div className="flex justify-between text-ui-label">
                        <span className="text-muted-foreground">{t('systemMonitor.gpuLabel')}</span>
                        <GpuValue value={gpu.utilization ?? 0}>
                          {(gpu.utilization ?? 0).toFixed(0)}%
                        </GpuValue>
                      </div>
                      <Progress value={gpu.utilization ?? 0} className={`h-1 ${getProgressColor(gpu.utilization ?? 0)}`} />
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex justify-between text-ui-label">
                        <span className="text-muted-foreground">{t('systemMonitor.vram')}</span>
                        <GpuValue value={gpu.memory_percent ?? 0}>
                          {(gpu.memory_percent ?? 0).toFixed(0)}%
                        </GpuValue>
                      </div>
                      <Progress value={gpu.memory_percent ?? 0} className={`h-1 ${getProgressColor(gpu.memory_percent ?? 0)}`} />
                      <div className="text-ui-label text-muted-foreground text-right">
                        {(gpu.memory_used ?? 0).toLocaleString()} MiB / {(gpu.memory_total ?? 0).toLocaleString()} MiB
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-ui-label text-muted-foreground">
                    {gpu.temperature != null && (
                      <GpuValue value={gpu.temperature} temperature>
                        {gpu.temperature.toFixed(0)}°C
                      </GpuValue>
                    )}
                    {gpu.power_draw != null && (
                      <span>
                        {gpu.power_draw.toFixed(0)}W
                        {gpu.power_limit != null && `/${gpu.power_limit.toFixed(0)}W`}
                      </span>
                    )}
                    {gpu.fan_speed != null && (
                      <span>{t('systemMonitor.fan')} {gpu.fan_speed.toFixed(0)}%</span>
                    )}
                  </div>
                </div>
              ))}

              <MonitorTrend
                label={t('systemMonitor.combinedUsageHistory')}
                domain={[0, 100]}
                series={gpuStats.map(gpu => ({
                  id: `gpu-${gpu.index}`, label: t('systemMonitor.gpuIndex', { index: gpu.index }),
                  ...getGpuTrendStyle(gpu.index), formatValue: formatPercent,
                  points: (gpuHistory.get(gpu.index) ?? []).map(point => ({ timestamp: point.timestamp, value: point.utilization })),
                }))}
              />
            </div>
          ) : (
            <div className="space-y-2">
              {(() => {
                const currentGpu = gpuStats.find(g => g.index === selectedGpuIndex) || gpuStats[0];
                const gpuInfo = gpuDetection.gpus.find(g => g.index === selectedGpuIndex) || gpuDetection.gpus[0];

                if (!currentGpu) {
                  return <div className="text-ui-label text-muted-foreground">{t('systemMonitor.loadingGpuStats')}</div>;
                }

                const history = gpuHistory.get(currentGpu.index) ?? [];

                return (
                  <>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-ui-label font-medium truncate" title={currentGpu.name}>
                        {currentGpu.name}
                      </span>
                      <Badge variant="outline" className="text-ui-label px-1 py-0 min-h-4">
                        {currentGpu.vendor === 'nvidia' ? 'NVIDIA' : currentGpu.vendor === 'amd' ? 'AMD' : 'Unknown'}
                      </Badge>
                      {gpuInfo?.driver_version && (
                        <Badge variant="secondary" className="text-ui-label px-1 py-0 min-h-4">
                          {gpuInfo.driver_version}
                        </Badge>
                      )}
                      {gpuInfo?.cuda_version && (
                        <Badge variant="secondary" className="text-ui-label px-1 py-0 min-h-4">
                          CUDA {gpuInfo.cuda_version}
                        </Badge>
                      )}
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between items-center gap-1">
                        <span className="text-ui-body font-medium">{t('systemMonitor.gpuUtilization')}</span>
                        <GpuValue value={currentGpu.utilization ?? 0}>
                          {(currentGpu.utilization ?? 0).toFixed(1)}%
                        </GpuValue>
                      </div>
                      <Progress value={currentGpu.utilization ?? 0} className={`h-1.5 ${getProgressColor(currentGpu.utilization ?? 0)}`} />
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between items-center gap-1">
                        <span className="text-ui-body font-medium">{t('systemMonitor.vram')}</span>
                        <GpuValue value={currentGpu.memory_percent ?? 0}>
                          {(currentGpu.memory_percent ?? 0).toFixed(1)}%
                        </GpuValue>
                      </div>
                      <Progress value={currentGpu.memory_percent ?? 0} className={`h-1.5 ${getProgressColor(currentGpu.memory_percent ?? 0)}`} />
                      <div className="text-ui-label text-muted-foreground text-right leading-tight">
                        {currentGpu.memory_used ?? 0} MiB / {currentGpu.memory_total ?? 0} MiB
                      </div>
                    </div>

                    <div className="monitor-gpu-details grid gap-1.5 text-ui-label">
                      {currentGpu.temperature != null && (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-muted-foreground">{t('systemMonitor.temp')}</span>
                          <GpuValue value={currentGpu.temperature} temperature>
                            {currentGpu.temperature.toFixed(0)}°C
                          </GpuValue>
                        </div>
                      )}
                      {currentGpu.power_draw != null && (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-muted-foreground">{t('systemMonitor.power')}</span>
                          <span className="text-ui-body font-medium tabular-nums">
                            {currentGpu.power_draw.toFixed(0)}W
                            {currentGpu.power_limit != null && (
                              <span className="text-muted-foreground font-normal"> / {currentGpu.power_limit.toFixed(0)}W</span>
                            )}
                          </span>
                        </div>
                      )}
                      {currentGpu.fan_speed != null && (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-muted-foreground">{t('systemMonitor.fan')}</span>
                          <span className="text-ui-body font-medium tabular-nums">{currentGpu.fan_speed.toFixed(0)}%</span>
                        </div>
                      )}
                    </div>

                    {(currentGpu.encoder_util != null || currentGpu.decoder_util != null) && (
                      <div className="grid grid-cols-2 gap-1.5 text-ui-label">
                        {currentGpu.encoder_util != null && (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-muted-foreground">{t('systemMonitor.encoder')}</span>
                            <GpuValue value={currentGpu.encoder_util}>
                              {currentGpu.encoder_util.toFixed(0)}%
                            </GpuValue>
                          </div>
                        )}
                        {currentGpu.decoder_util != null && (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-muted-foreground">{t('systemMonitor.decoder')}</span>
                            <GpuValue value={currentGpu.decoder_util}>
                              {currentGpu.decoder_util.toFixed(0)}%
                            </GpuValue>
                          </div>
                        )}
                      </div>
                    )}

                    <MonitorTrend
                      label={t('systemMonitor.usageHistory')}
                      domain={[0, 100]}
                      series={[
                        { id: 'utilization', label: t('systemMonitor.gpuLabel'), color: CHART_COLORS.monitorPrimary, formatValue: formatPercent,
                          points: history.map(point => ({ timestamp: point.timestamp, value: point.utilization })) },
                        { id: 'memory', label: t('systemMonitor.vram'), color: CHART_COLORS.chart5, dash: '4 3', formatValue: formatPercent,
                          points: history.map(point => ({ timestamp: point.timestamp, value: point.memory })) },
                      ]}
                    />
                    {history.some(point => point.temperature !== undefined && Number.isFinite(point.temperature)) && (
                      <MonitorTrend
                        label={t('systemMonitor.temperatureHistory')}
                        domain={[0, Math.ceil(Math.max(100, ...history.map(point => Number.isFinite(point.temperature) ? point.temperature! : 0)) / 10) * 10]}
                        series={[{
                          id: 'temperature', label: t('systemMonitor.temp'), color: 'var(--foreground)',
                          formatValue: value => `${value.toFixed(0)}°C`,
                          points: history.map(point => ({ timestamp: point.timestamp, value: point.temperature ?? null })),
                        }]}
                      />
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
