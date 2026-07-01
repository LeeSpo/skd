import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { Cpu } from 'lucide-react';
import { withRetry, CancelledError } from '@/lib/async-retry';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, CardContent } from '../ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Progress } from '../ui/progress';
import { Badge } from '../ui/badge';
import type {
  GpuDetectionResult,
  GpuHistoryData,
  GpuStats,
  MonitorPanelProps,
} from './monitor-types';
import { GPU_COLORS, getGpuTempColor, getProgressColor, getUsageColor, scheduleIdleTask } from './monitor-utils';

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGpuDetection(null);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGpuStats([]);
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
        <div className="flex items-center gap-1.5">
          <Cpu className="w-3 h-3 shrink-0" />
          <h3 className="text-xs font-medium truncate">{t('systemMonitor.gpuMonitor')}</h3>
        </div>
        {gpuDetection?.available && gpuDetection.gpus.length > 1 && (
          <Select
            value={selectedGpuIndex.toString()}
            onValueChange={(value) => setSelectedGpuIndex(value === 'all' ? 'all' : parseInt(value))}
          >
            <SelectTrigger className="h-5 w-auto min-w-[70px] max-w-[120px] text-[9px] px-1.5 py-0">
              <SelectValue placeholder={t('systemMonitor.selectGpu')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-[10px]">
                {t('systemMonitor.allGpus')}
              </SelectItem>
              {gpuDetection.gpus.map(gpu => (
                <SelectItem key={gpu.index} value={gpu.index.toString()} className="text-[10px]">
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
            <div className="text-[10px] text-muted-foreground space-y-1">
              <p>{t('systemMonitor.noGpuDetected')}</p>
              <p className="text-[9px]">{t('systemMonitor.supportedGpus')}</p>
            </div>
          ) : selectedGpuIndex === 'all' ? (
            <div className="space-y-2">
              {gpuStats.map((gpu, idx) => (
                <div key={gpu.index} className="border rounded p-1.5 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: GPU_COLORS[idx % GPU_COLORS.length] }}
                    />
                    <span className="text-[10px] font-medium truncate">
                      GPU {gpu.index}: {gpu.name}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-0.5">
                      <div className="flex justify-between text-[9px]">
                        <span className="text-muted-foreground">{t('systemMonitor.gpuLabel')}</span>
                        <span className={`font-semibold ${getUsageColor(gpu.utilization ?? 0)}`}>
                          {(gpu.utilization ?? 0).toFixed(0)}%
                        </span>
                      </div>
                      <Progress value={gpu.utilization ?? 0} className={`h-1 ${getProgressColor(gpu.utilization ?? 0)}`} />
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex justify-between text-[9px]">
                        <span className="text-muted-foreground">{t('systemMonitor.vram')}</span>
                        <span className={`font-semibold ${getUsageColor(gpu.memory_percent ?? 0)}`}>
                          {(gpu.memory_percent ?? 0).toFixed(0)}%
                        </span>
                      </div>
                      <Progress value={gpu.memory_percent ?? 0} className={`h-1 ${getProgressColor(gpu.memory_percent ?? 0)}`} />
                      <div className="text-[8px] text-muted-foreground text-right">
                        {(gpu.memory_used ?? 0).toLocaleString()} MiB / {(gpu.memory_total ?? 0).toLocaleString()} MiB
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 text-[9px] text-muted-foreground">
                    {gpu.temperature != null && (
                      <span className={getGpuTempColor(gpu.temperature)}>
                        {gpu.temperature.toFixed(0)}°C
                      </span>
                    )}
                    {gpu.power_draw != null && (
                      <span>
                        {gpu.power_draw.toFixed(0)}W
                        {gpu.power_limit != null && `/${gpu.power_limit.toFixed(0)}W`}
                      </span>
                    )}
                    {gpu.fan_speed != null && (
                      <span>Fan {gpu.fan_speed.toFixed(0)}%</span>
                    )}
                  </div>
                </div>
              ))}

              {gpuStats.length > 0 && gpuHistory.size > 0 && (
                <div>
                  <div className="text-[9px] text-muted-foreground mb-1">{t('systemMonitor.combinedUsageHistory')}</div>
                  <div className="h-24 text-foreground">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart margin={{ top: 5, right: 2, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" opacity={0.2} />
                        <XAxis
                          dataKey="time"
                          type="category"
                          allowDuplicatedCategory={false}
                          tick={{ fontSize: 8, fill: 'currentColor' }}
                          stroke="hsl(var(--muted-foreground))"
                          strokeWidth={0.5}
                          interval="preserveStartEnd"
                          minTickGap={30}
                        />
                        <YAxis
                          tick={{ fontSize: 8, fill: 'currentColor' }}
                          stroke="hsl(var(--muted-foreground))"
                          strokeWidth={0.5}
                          domain={[0, 100]}
                          ticks={[0, 50, 100]}
                          width={25}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'hsl(var(--popover))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '6px',
                            fontSize: '11px',
                          }}
                          formatter={(value: number | string, name: string) => [`${Number(value).toFixed(1)}%`, name === 'utilization' ? t('systemMonitor.gpuLabel') : name]}
                        />
                        {gpuStats.map((gpu, idx) => {
                          const history = gpuHistory.get(gpu.index) || [];
                          return (
                            <Line
                              key={gpu.index}
                              data={history}
                              dataKey="utilization"
                              name={`GPU ${gpu.index}`}
                              type="monotone"
                              stroke={GPU_COLORS[idx % GPU_COLORS.length]}
                              strokeWidth={2}
                              dot={false}
                              isAnimationActive={false}
                            />
                          );
                        })}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex gap-3 justify-center mt-1 flex-wrap">
                    {gpuStats.map((gpu, idx) => (
                      <div key={gpu.index} className="flex items-center gap-1">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: GPU_COLORS[idx % GPU_COLORS.length] }}
                        />
                        <span className="text-[8px] text-muted-foreground">{t('systemMonitor.gpuIndex', { index: gpu.index })}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {(() => {
                const currentGpu = gpuStats.find(g => g.index === selectedGpuIndex) || gpuStats[0];
                const gpuInfo = gpuDetection.gpus.find(g => g.index === selectedGpuIndex) || gpuDetection.gpus[0];

                if (!currentGpu) {
                  return <div className="text-[10px] text-muted-foreground">{t('systemMonitor.loadingGpuStats')}</div>;
                }

                return (
                  <>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-medium truncate" title={currentGpu.name}>
                        {currentGpu.name}
                      </span>
                      <Badge variant="outline" className="text-[8px] px-1 py-0 h-4">
                        {currentGpu.vendor === 'nvidia' ? 'NVIDIA' : currentGpu.vendor === 'amd' ? 'AMD' : 'Unknown'}
                      </Badge>
                      {gpuInfo?.driver_version && (
                        <Badge variant="secondary" className="text-[8px] px-1 py-0 h-4">
                          {gpuInfo.driver_version}
                        </Badge>
                      )}
                      {gpuInfo?.cuda_version && (
                        <Badge variant="secondary" className="text-[8px] px-1 py-0 h-4">
                          CUDA {gpuInfo.cuda_version}
                        </Badge>
                      )}
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between items-center gap-1">
                        <span className="text-xs font-medium">{t('systemMonitor.gpuUtilization')}</span>
                        <span className={`text-xs font-semibold ${getUsageColor(currentGpu.utilization ?? 0)}`}>
                          {(currentGpu.utilization ?? 0).toFixed(1)}%
                        </span>
                      </div>
                      <Progress value={currentGpu.utilization ?? 0} className={`h-1.5 ${getProgressColor(currentGpu.utilization ?? 0)}`} />
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between items-center gap-1">
                        <span className="text-xs font-medium">{t('systemMonitor.vram')}</span>
                        <span className={`text-xs font-semibold ${getUsageColor(currentGpu.memory_percent ?? 0)}`}>
                          {(currentGpu.memory_percent ?? 0).toFixed(1)}%
                        </span>
                      </div>
                      <Progress value={currentGpu.memory_percent ?? 0} className={`h-1.5 ${getProgressColor(currentGpu.memory_percent ?? 0)}`} />
                      <div className="text-[9px] text-muted-foreground text-right leading-tight">
                        {currentGpu.memory_used ?? 0} MiB / {currentGpu.memory_total ?? 0} MiB
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5 text-[10px]">
                      {currentGpu.temperature != null && (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-muted-foreground">{t('systemMonitor.temp')}</span>
                          <span className={`font-semibold ${getGpuTempColor(currentGpu.temperature)}`}>
                            {currentGpu.temperature.toFixed(0)}°C
                          </span>
                        </div>
                      )}
                      {currentGpu.power_draw != null && (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-muted-foreground">{t('systemMonitor.power')}</span>
                          <span className="font-semibold">
                            {currentGpu.power_draw.toFixed(0)}W
                            {currentGpu.power_limit != null && (
                              <span className="text-muted-foreground font-normal">/{currentGpu.power_limit.toFixed(0)}W</span>
                            )}
                          </span>
                        </div>
                      )}
                      {currentGpu.fan_speed != null && (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-muted-foreground">{t('systemMonitor.fan')}</span>
                          <span className="font-semibold">{currentGpu.fan_speed.toFixed(0)}%</span>
                        </div>
                      )}
                    </div>

                    {(currentGpu.encoder_util != null || currentGpu.decoder_util != null) && (
                      <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                        {currentGpu.encoder_util != null && (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-muted-foreground">{t('systemMonitor.encoder')}</span>
                            <span className={`font-semibold ${getUsageColor(currentGpu.encoder_util)}`}>
                              {currentGpu.encoder_util.toFixed(0)}%
                            </span>
                          </div>
                        )}
                        {currentGpu.decoder_util != null && (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-muted-foreground">{t('systemMonitor.decoder')}</span>
                            <span className={`font-semibold ${getUsageColor(currentGpu.decoder_util)}`}>
                              {currentGpu.decoder_util.toFixed(0)}%
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {gpuHistory.get(currentGpu.index)?.length ? (
                      <div>
                        <div className="text-[9px] text-muted-foreground mb-1">{t('systemMonitor.usageHistory')}</div>
                        <div className="h-20 text-foreground">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart
                              data={gpuHistory.get(currentGpu.index) || []}
                              margin={{ top: 5, right: 2, left: 0, bottom: 5 }}
                            >
                              <defs>
                                <linearGradient id="gpuUtilGradient" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
                                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.05} />
                                </linearGradient>
                                <linearGradient id="gpuMemGradient" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.3} />
                                  <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.05} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" className="stroke-border" opacity={0.2} />
                              <XAxis
                                dataKey="time"
                                tick={{ fontSize: 8, fill: 'currentColor' }}
                                stroke="hsl(var(--muted-foreground))"
                                strokeWidth={0.5}
                                interval="preserveStartEnd"
                                minTickGap={30}
                              />
                              <YAxis
                                tick={{ fontSize: 8, fill: 'currentColor' }}
                                stroke="hsl(var(--muted-foreground))"
                                strokeWidth={0.5}
                                domain={[0, 100]}
                                ticks={[0, 50, 100]}
                                width={25}
                              />
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: 'hsl(var(--popover))',
                                  border: '1px solid hsl(var(--border))',
                                  borderRadius: '6px',
                                  fontSize: '11px',
                                }}
                                formatter={(value: number | string, name: string) => [
                                  `${Number(value).toFixed(1)}%`,
                                  name === 'utilization' ? t('systemMonitor.gpuLabel') : t('systemMonitor.vram'),
                                ]}
                              />
                              <Area
                                type="monotone"
                                dataKey="utilization"
                                stroke="#8b5cf6"
                                strokeWidth={2}
                                fill="url(#gpuUtilGradient)"
                                dot={false}
                                isAnimationActive={false}
                              />
                              <Area
                                type="monotone"
                                dataKey="memory"
                                stroke="#06b6d4"
                                strokeWidth={2}
                                fill="url(#gpuMemGradient)"
                                dot={false}
                                isAnimationActive={false}
                              />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="flex gap-3 justify-center mt-1">
                          <div className="flex items-center gap-1">
                            <div className="w-2 h-2 rounded-full bg-[#8b5cf6]" />
                            <span className="text-[8px] text-muted-foreground">{t('systemMonitor.gpuLabel')}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <div className="w-2 h-2 rounded-full bg-[#06b6d4]" />
                            <span className="text-[8px] text-muted-foreground">{t('systemMonitor.vram')}</span>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {gpuHistory.get(currentGpu.index)?.some(h => h.temperature !== undefined) && (
                      <div>
                        <div className="text-[9px] text-muted-foreground mb-1">{t('systemMonitor.temperatureHistory')}</div>
                        <div className="h-16 text-foreground">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart
                              data={gpuHistory.get(currentGpu.index) || []}
                              margin={{ top: 5, right: 2, left: 0, bottom: 5 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" className="stroke-border" opacity={0.2} />
                              <XAxis
                                dataKey="time"
                                tick={{ fontSize: 8, fill: 'currentColor' }}
                                stroke="hsl(var(--muted-foreground))"
                                strokeWidth={0.5}
                                interval="preserveStartEnd"
                                minTickGap={30}
                              />
                              <YAxis
                                tick={{ fontSize: 8, fill: 'currentColor' }}
                                stroke="hsl(var(--muted-foreground))"
                                strokeWidth={0.5}
                                domain={[30, 100]}
                                ticks={[40, 60, 80]}
                                width={25}
                              />
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: 'hsl(var(--popover))',
                                  border: '1px solid hsl(var(--border))',
                                  borderRadius: '6px',
                                  fontSize: '11px',
                                }}
                                formatter={(value: number | string) => [`${Number(value).toFixed(0)}°C`, t('systemMonitor.temp')]}
                              />
                              <Line
                                type="monotone"
                                dataKey="temperature"
                                stroke="#f97316"
                                strokeWidth={2}
                                dot={false}
                                isAnimationActive={false}
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
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
