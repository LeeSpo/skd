// Transfer Queue State Management
// Manages file transfers between local and remote panels.

export type TransferStatus =
  | "queued"
  | "transferring"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled";

export type TransferDirection = "upload" | "download";

export interface TransferItem {
  id: string;
  connectionId?: string;
  connectionName?: string | null;
  source?: import('./transfer-queue-service').TransferSource;
  ownerId?: string | null;
  ownerWindow?: string | null;
  fileName: string;
  direction: TransferDirection;
  sourcePath: string;
  destinationPath: string;
  status: TransferStatus;
  progress: number; // 0-100
  bytesTransferred: number;
  totalBytes: number | null;
  speed: number; // bytes/sec
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export type TransferAction =
  | {
      type: "ENQUEUE";
      items: Array<{
        connectionId?: string;
        connectionName?: string;
        fileName: string;
        direction: TransferDirection;
        sourcePath: string;
        destinationPath: string;
        totalBytes: number;
      }>;
    }
  | { type: "START"; id: string }
  | {
      type: "PROGRESS";
      id: string;
      progress: number;
      bytesTransferred: number;
      speed: number;
      totalBytes?: number | null;
    }
  | { type: "COMPLETE"; id: string; bytesTransferred?: number | null }
  | { type: "FAIL"; id: string; error: string }
  | { type: "CANCEL"; id: string }
  | { type: "RETRY"; id: string }
  | { type: "CLEAR_COMPLETED" }
  | { type: "CLEAR_ALL" };

let nextId = 1;

/** Generate a unique transfer ID. */
export function generateTransferId(): string {
  return `transfer-${nextId++}-${Date.now()}`;
}

/** Reset the ID counter (for testing). */
export function resetTransferIdCounter(): void {
  nextId = 1;
}

export function transferQueueReducer(
  state: TransferItem[],
  action: TransferAction,
): TransferItem[] {
  switch (action.type) {
    case "ENQUEUE": {
      const newItems: TransferItem[] = action.items.map((item) => ({
        connectionId: item.connectionId, connectionName: item.connectionName,
        id: generateTransferId(),
        fileName: item.fileName,
        direction: item.direction,
        sourcePath: item.sourcePath,
        destinationPath: item.destinationPath,
        status: "queued" as const,
        progress: 0,
        bytesTransferred: 0,
        totalBytes: item.totalBytes,
        speed: 0,
      }));
      return [...state, ...newItems];
    }

    case "START": {
      return state.map((item) =>
        item.id === action.id && item.status === "queued"
          ? { ...item, status: "transferring" as const, startedAt: Date.now() }
          : item,
      );
    }

    case "PROGRESS": {
      return state.map((item) =>
        item.id === action.id && item.status === "transferring"
          ? {
              ...item,
              progress: action.progress,
              bytesTransferred: action.bytesTransferred,
              speed: action.speed,
              totalBytes: action.totalBytes === undefined ? item.totalBytes : action.totalBytes,
            }
          : item,
      );
    }

    case "COMPLETE": {
      return state.map((item) =>
        item.id === action.id && item.status === "transferring"
          ? {
              ...item,
              status: "completed" as const,
              progress: 100,
              bytesTransferred: action.bytesTransferred ?? item.bytesTransferred,
              totalBytes: action.bytesTransferred ?? item.totalBytes,
              completedAt: Date.now(),
            }
          : item,
      );
    }

    case "FAIL": {
      return state.map((item) =>
        item.id === action.id && item.status === "transferring"
          ? {
              ...item,
              status: "failed" as const,
              error: action.error,
              completedAt: Date.now(),
            }
          : item,
      );
    }

    case "CANCEL": {
      return state.map((item) =>
        item.id === action.id && item.status !== "completed"
          ? { ...item, status: "cancelled" as const, completedAt: Date.now() }
          : item,
      );
    }

    case "RETRY": {
      return state.map((item) =>
        item.id === action.id &&
        (item.status === "failed" || item.status === "cancelled")
          ? {
              ...item,
              status: "queued" as const,
              progress: 0,
              bytesTransferred: 0,
              speed: 0,
              error: undefined,
              startedAt: undefined,
              completedAt: undefined,
            }
          : item,
      );
    }

    case "CLEAR_COMPLETED": {
      return state.filter(
        (item) =>
          item.status !== "completed" &&
          item.status !== "failed" &&
          item.status !== "cancelled",
      );
    }

    case "CLEAR_ALL": {
      // Only keep items that are currently transferring
      return state.filter((item) => item.status === "transferring");
    }

    default:
      return state;
  }
}

// ---- Selectors ----

export function getActiveTransferCount(state: TransferItem[]): number {
  return state.filter(
    (item) => item.status === "queued" || item.status === "transferring" || item.status === "cancelling",
  ).length;
}

export function getNextQueuedTransfer(
  state: TransferItem[],
): TransferItem | undefined {
  const hasTransferring = state.some(
    (item) => item.status === "transferring",
  );
  if (hasTransferring) return undefined;
  return state.find((item) => item.status === "queued");
}
