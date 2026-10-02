import { invoke } from '@tauri-apps/api/core';

export interface WebSocketEndpoint {
  port: number;
  token: string;
}

/** Obtain a fresh authenticated endpoint for each connection attempt. */
export async function getWebSocketUrl(): Promise<string> {
  try {
    const endpoint = await invoke<WebSocketEndpoint>('get_websocket_endpoint');
    if (
      !endpoint
      || !Number.isInteger(endpoint.port)
      || endpoint.port < 9001
      || endpoint.port > 9010
      || typeof endpoint.token !== 'string'
      || !endpoint.token.trim()
    ) {
      throw new Error('Invalid terminal bridge endpoint');
    }
    return `ws://127.0.0.1:${endpoint.port}/?token=${encodeURIComponent(endpoint.token)}`;
  } catch {
    // Do not propagate IPC errors that could contain the endpoint secret.
    // In particular, never fall back to an unauthenticated localhost port.
    throw new Error('Terminal bridge endpoint unavailable');
  }
}
