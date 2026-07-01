export interface SystemStats {
  cpu: number;
  memory: number;
  memoryTotal?: number;
  memoryUsed?: number;
  swap?: number;
  swapTotal?: number;
  swapUsed?: number;
  diskUsage: number;
  uptime: string;
}

export interface Process {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  command: string;
}

export interface DiskUsage {
  path: string;
  filesystem: string;
  total: string;
  used: string;
  available: string;
  usage: number;
}

export interface LatencyData {
  time: string;
  latency: number;
  timestamp: number;
}

export interface NetworkUsage {
  upload: number;
  download: number;
  uploadFormatted: string;
  downloadFormatted: string;
}

export interface NetworkHistoryData {
  time: string;
  download: number;
  upload: number;
  timestamp: number;
}

export interface InterfaceBandwidth {
  interface: string;
  rx_bytes_per_sec: number;
  tx_bytes_per_sec: number;
}

export type GpuVendor = 'nvidia' | 'amd' | 'unknown';

export interface GpuInfo {
  index: number;
  name: string;
  vendor: GpuVendor;
  driver_version?: string;
  cuda_version?: string;
}

export interface GpuStats {
  index: number;
  name: string;
  vendor: GpuVendor;
  utilization: number;
  memory_used: number;
  memory_total: number;
  memory_percent: number;
  temperature?: number;
  power_draw?: number;
  power_limit?: number;
  fan_speed?: number;
  encoder_util?: number;
  decoder_util?: number;
}

export interface GpuDetectionResult {
  available: boolean;
  vendor: GpuVendor;
  gpus: GpuInfo[];
  detection_method: string;
}

export interface GpuHistoryData {
  time: string;
  utilization: number;
  memory: number;
  temperature?: number;
  timestamp: number;
}

export interface MonitorPanelProps {
  connectionId: string;
  active?: boolean;
}
