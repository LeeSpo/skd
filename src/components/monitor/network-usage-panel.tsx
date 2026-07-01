import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { ArrowDownUp } from 'lucide-react';
import { withRetry, CancelledError } from '@/lib/async-retry';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Card, CardContent } from '../ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import type { MonitorPanelProps, NetworkHistoryData, NetworkUsage } from './monitor-types';
import { scheduleIdleTask } from './monitor-utils';

export function NetworkUsagePanel({ connectionId, active = true }: MonitorPanelProps) {
  const { t } = useTranslation();
  const [networkUsage, setNetworkUsage] = useState<NetworkUsage>({
    upload: 0,
    download: 0,
    uploadFormatted: '0 KB/s',
    downloadFormatted: '0 KB/s',
  });
  const [networkHistory, setNetworkHistory] = useState<NetworkHistoryData[]>([]);
  const [networkInterfaces, setNetworkInterfaces] = useState<string[]>([]);
  const [selectedInterface, setSelectedInterface] = useState<string>('all');

  useEffect(() => {
    if (!active) return;

    let cancelled = false;

    const fetchBandwidth = async (isCancelled: () => boolean = () => false) => {
      const result = await invoke<{
        success: boolean;
        bandwidth: Array<{
          interface: string;
          rx_bytes_per_sec: number;
          tx_bytes_per_sec: number;
        }>;
        error?: string;
      }>('get_network_bandwidth', { connectionId });

      if (isCancelled()) return;

      if (result.success && result.bandwidth.length > 0) {
        const interfaceNames = result.bandwidth.map(iface => iface.interface);
        setNetworkInterfaces(prevInterfaces => {
          if (JSON.stringify(prevInterfaces) !== JSON.stringify(interfaceNames)) {
            setSelectedInterface(prev => {
              if (prev === 'all' || !interfaceNames.includes(prev)) {
                const outboundInterface = interfaceNames.find(name =>
                  name.startsWith('eth') || name.startsWith('ens') || name.startsWith('enp'),
                ) || interfaceNames[0];
                return outboundInterface || 'all';
              }
              return prev;
            });
            return interfaceNames;
          }
          return prevInterfaces;
        });

        let totalDownload = 0;
        let totalUpload = 0;

        if (selectedInterface === 'all') {
          result.bandwidth.forEach(iface => {
            totalDownload += iface.rx_bytes_per_sec;
            totalUpload += iface.tx_bytes_per_sec;
          });
        } else {
          const selectedData = result.bandwidth.find(iface => iface.interface === selectedInterface);
          if (selectedData) {
            totalDownload = selectedData.rx_bytes_per_sec;
            totalUpload = selectedData.tx_bytes_per_sec;
          }
        }

        const downloadKBps = totalDownload / 1024;
        const uploadKBps = totalUpload / 1024;

        const formatSpeed = (kbps: number): string => {
          if (kbps >= 1024) {
            return `${(kbps / 1024).toFixed(1)} MB/s`;
          }
          return `${kbps.toFixed(0)} KB/s`;
        };

        setNetworkUsage({
          upload: uploadKBps,
          download: downloadKBps,
          uploadFormatted: formatSpeed(uploadKBps),
          downloadFormatted: formatSpeed(downloadKBps),
        });

        const now = new Date();
        const newHistoryPoint: NetworkHistoryData = {
          time: now.toLocaleTimeString().slice(0, 8),
          download: Math.round(downloadKBps),
          upload: Math.round(uploadKBps),
          timestamp: now.getTime(),
        };

        setNetworkHistory(prev => [...prev, newHistoryPoint].slice(-60));
      }
    };

    void withRetry(() => fetchBandwidth(() => cancelled), () => cancelled, { maxRetries: 2 })
      .catch(err => { if (!(err instanceof CancelledError)) console.error('Network bandwidth initial fetch failed:', err); });

    const interval = setInterval(() => {
      scheduleIdleTask(() => { void fetchBandwidth(() => cancelled).catch(() => {}); });
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [connectionId, selectedInterface, active]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5">
          <ArrowDownUp className="w-3 h-3 shrink-0" />
          <h3 className="text-xs font-medium truncate">{t('systemMonitor.networkUsage')}</h3>
        </div>
        {networkInterfaces.length > 0 && (
          <Select
            value={selectedInterface}
            onValueChange={(value) => {
              setSelectedInterface(value);
              setNetworkHistory([]);
            }}
          >
            <SelectTrigger className="h-5 w-auto min-w-[70px] max-w-[100px] text-[9px] px-1.5 py-0">
              <SelectValue placeholder={t('systemMonitor.selectInterface')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-[10px]">
                {t('systemMonitor.allInterfaces')}
              </SelectItem>
              {networkInterfaces.map(iface => (
                <SelectItem key={iface} value={iface} className="text-[10px]">
                  {iface}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <Card>
        <CardContent className="p-2 space-y-2">
          <div className="grid grid-cols-2 gap-1.5">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-[#3b82f6] shrink-0" />
                <div className="text-[9px] text-muted-foreground">{t('systemMonitor.down')}</div>
              </div>
              <div className="font-medium text-[10px] truncate" title={networkUsage.downloadFormatted}>
                {networkUsage.downloadFormatted}
              </div>
            </div>
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-[#ef4444] shrink-0" />
                <div className="text-[9px] text-muted-foreground">{t('systemMonitor.up')}</div>
              </div>
              <div className="font-medium text-[10px] truncate" title={networkUsage.uploadFormatted}>
                {networkUsage.uploadFormatted}
              </div>
            </div>
          </div>

          <div>
            <div className="text-[9px] text-muted-foreground mb-1">{t('systemMonitor.history')}</div>
            <div className="h-24 text-foreground">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={networkHistory.map(item => ({
                    ...item,
                    uploadPositive: item.upload,
                    downloadNegative: -item.download,
                  }))}
                  margin={{ top: 5, right: 2, left: 0, bottom: 5 }}
                >
                  <defs>
                    <linearGradient id="uploadGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#ef4444" stopOpacity={0.05} />
                    </linearGradient>
                    <linearGradient id="downloadGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.05} />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.3} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" opacity={0.2} />
                  <XAxis
                    dataKey="time"
                    axisLine
                    tick={{ fontSize: 8, fill: 'currentColor' }}
                    stroke="hsl(var(--muted-foreground))"
                    tickLine={false}
                    interval="preserveStartEnd"
                    minTickGap={50}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: 'currentColor' }}
                    stroke="hsl(var(--muted-foreground))"
                    domain={[-1500, 1500]}
                    ticks={[-1228.8, -614.4, 0, 614.4, 1228.8]}
                    tickFormatter={(value: number) => {
                      const absValue = Math.abs(value);
                      if (absValue === 0) return '0';
                      if (absValue >= 1024) {
                        return `${(absValue / 1024).toFixed(1)} MB/s`;
                      }
                      return `${absValue.toFixed(0)} KB/s`;
                    }}
                    width={50}
                    tickLine={false}
                  />
                  <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '6px',
                      fontSize: '11px',
                    }}
                    formatter={(value: number | string, name: string) => {
                      const kbps = Math.abs(Number(value));
                      const formatted = kbps >= 1024 ? `${(kbps / 1024).toFixed(1)} MB/s` : `${kbps.toFixed(0)} KB/s`;
                      return [formatted, name === 'uploadPositive' ? t('systemMonitor.upload') : t('systemMonitor.download')];
                    }}
                    labelFormatter={(label) => `${label}`}
                  />
                  <Area
                    type="monotone"
                    dataKey="uploadPositive"
                    stroke="#ef4444"
                    strokeWidth={2}
                    fill="url(#uploadGradient)"
                    dot={false}
                    activeDot={{ r: 3, fill: '#ef4444', stroke: '#ef4444' }}
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="downloadNegative"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    fill="url(#downloadGradient)"
                    dot={false}
                    activeDot={{ r: 3, fill: '#3b82f6', stroke: '#3b82f6' }}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
