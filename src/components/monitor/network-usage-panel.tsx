import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { withRetry, CancelledError } from '@/lib/async-retry';
import { Card, CardContent } from '../ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import type { MonitorPanelProps, NetworkHistoryData, NetworkUsage } from './monitor-types';
import { CHART_COLORS } from '@/lib/chart-colors';
import { scheduleIdleTask } from './monitor-utils';
import { MonitorTrend } from './monitor-trend';

function formatSpeed(kbps: number): string {
  return kbps >= 1024 ? `${(kbps / 1024).toFixed(1)} MB/s` : `${kbps.toFixed(0)} KB/s`;
}

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
        <div className="min-w-0">
          <h3 className="text-ui-body font-medium truncate">{t('systemMonitor.networkUsage')}</h3>
        </div>
        {networkInterfaces.length > 0 && (
          <Select
            value={selectedInterface}
            onValueChange={(value) => {
              setSelectedInterface(value);
              setNetworkHistory([]);
            }}
          >
            <SelectTrigger aria-label={t('systemMonitor.selectInterface')} size="sm" className="w-auto min-w-[70px] max-w-[100px] text-ui-label px-1.5 py-0">
              <SelectValue placeholder={t('systemMonitor.selectInterface')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-ui-label">
                {t('systemMonitor.allInterfaces')}
              </SelectItem>
              {networkInterfaces.map(iface => (
                <SelectItem key={iface} value={iface} className="text-ui-label">
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
                <div className="w-3 h-px bg-[var(--monitor-trend-primary)] shrink-0" />
                <div className="text-ui-label text-muted-foreground">{t('systemMonitor.down')}</div>
              </div>
              <div className="font-medium text-ui-body tabular-nums truncate" title={networkUsage.downloadFormatted}>
                {networkUsage.downloadFormatted}
              </div>
            </div>
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1">
                <div className="w-3 border-t border-dashed border-chart-5 shrink-0" />
                <div className="text-ui-label text-muted-foreground">{t('systemMonitor.up')}</div>
              </div>
              <div className="font-medium text-ui-body tabular-nums truncate" title={networkUsage.uploadFormatted}>
                {networkUsage.uploadFormatted}
              </div>
            </div>
          </div>

          <MonitorTrend
            label={t('systemMonitor.networkUsage')}
            showLegend={false}
            series={[
              { id: 'download', label: t('systemMonitor.download'), color: CHART_COLORS.monitorPrimary, formatValue: formatSpeed,
                points: networkHistory.map(point => ({ timestamp: point.timestamp, value: point.download })) },
              { id: 'upload', label: t('systemMonitor.upload'), color: CHART_COLORS.chart5, dash: '4 3', formatValue: formatSpeed,
                points: networkHistory.map(point => ({ timestamp: point.timestamp, value: point.upload })) },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
