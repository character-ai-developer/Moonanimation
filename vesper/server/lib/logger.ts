import type { LogEntry, LogType } from '../../shared/types';

const MAX_ENTRIES = 5000;

/**
 * Ring-buffer log store. Mirrors the desktop tool's five log categories
 * (method / filter / ratelimit / worker / lookup) and adds api / error / system.
 */
class LogStore {
  private entries: LogEntry[] = [];
  private listeners = new Set<(e: LogEntry) => void>();
  private seq = 0;

  push(type: LogType, message: string, meta: Partial<Omit<LogEntry, 'id' | 'ts' | 'type' | 'message'>> = {}): LogEntry {
    const entry: LogEntry = {
      id: `log_${++this.seq}`,
      ts: Date.now(),
      type,
      message,
      jobId: meta.jobId ?? null,
      userId: meta.userId ?? null,
      status: meta.status ?? null,
      detail: meta.detail ?? null,
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    for (const l of this.listeners) {
      try {
        l(entry);
      } catch {
        /* a dead SSE client must never break logging */
      }
    }
    return entry;
  }

  list(opts: { types?: LogType[]; search?: string; limit?: number; jobId?: string } = {}): LogEntry[] {
    let out = this.entries;
    if (opts.types && opts.types.length) out = out.filter((e) => opts.types!.includes(e.type));
    if (opts.jobId) out = out.filter((e) => e.jobId === opts.jobId);
    if (opts.search) {
      const q = opts.search.toLowerCase();
      out = out.filter(
        (e) => e.message.toLowerCase().includes(q) || (e.detail ?? '').toLowerCase().includes(q),
      );
    }
    const limit = opts.limit ?? 1000;
    return out.slice(-limit);
  }

  clear(): void {
    this.entries = [];
  }

  subscribe(fn: (e: LogEntry) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  count(): number {
    return this.entries.length;
  }
}

export const logStore = new LogStore();

export function log(
  type: LogType,
  message: string,
  meta: Partial<Omit<LogEntry, 'id' | 'ts' | 'type' | 'message'>> = {},
): void {
  logStore.push(type, message, meta);
}
