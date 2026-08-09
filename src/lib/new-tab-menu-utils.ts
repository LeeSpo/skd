import type { ConnectionData } from './connection-storage';

export function filterConnections(connections: ConnectionData[], query: string): ConnectionData[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return connections;

  return connections.filter((connection) => (
    [
      connection.name,
      connection.host,
      connection.username,
      connection.protocol,
      connection.folder,
    ]
      .filter(Boolean)
      .some((value) => value!.toLocaleLowerCase().includes(normalizedQuery))
  ));
}
