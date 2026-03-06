import type { TimeEntry, TrackData } from './types.js';

const DEFAULT_IDLE_THRESHOLD = 60;

export function getIdleThreshold(): number {
  const env = process.env.IDLE_THRESHOLD_MINUTES;
  if (env) {
    const parsed = parseInt(env, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_IDLE_THRESHOLD;
}

export function findActiveEntry(data: TrackData): TimeEntry | undefined {
  return data.entries.find((e) => e.status === 'active')
    ?? data.entries.find((e) => e.status === 'paused');
}

export function findEntry(data: TrackData, ticketId: string): TimeEntry | undefined {
  return data.entries.find((e) => e.ticketId === ticketId);
}

export function checkIdle(entry: TimeEntry): string | null {
  if (entry.status !== 'active') return null;

  const now = Date.now();
  const lastActivity = new Date(entry.lastActivityAt).getTime();
  const thresholdMs = entry.idleThresholdMinutes * 60 * 1000;

  if (now - lastActivity > thresholdMs) {
    const idleStart = new Date(lastActivity + thresholdMs).toISOString();
    entry.pauses.push({ start: idleStart });
    entry.status = 'paused';
    const idleMinutes = Math.round((now - lastActivity - thresholdMs) / 60000);
    return `Idle detected: auto-paused. ${idleMinutes}m of idle time excluded since ${idleStart}`;
  }
  return null;
}

export function touchActivity(entry: TimeEntry): void {
  entry.lastActivityAt = new Date().toISOString();
}

export function startEntry(
  data: TrackData,
  ticketId: string,
  idleThresholdMinutes?: number,
): { entry: TimeEntry; stoppedPrevious?: string } {
  const existing = findEntry(data, ticketId);
  if (existing && (existing.status === 'active' || existing.status === 'paused')) {
    throw new Error(`Already tracking ${ticketId}`);
  }

  let stoppedPrevious: string | undefined;
  const active = findActiveEntry(data);
  if (active) {
    active.stoppedAt = new Date().toISOString();
    active.status = 'completed';
    if (active.pauses.length > 0) {
      const lastPause = active.pauses[active.pauses.length - 1];
      if (!lastPause.end) lastPause.end = active.stoppedAt;
    }
    stoppedPrevious = active.ticketId;
  }

  const now = new Date().toISOString();
  const entry: TimeEntry = {
    ticketId,
    startedAt: now,
    status: 'active',
    pauses: [],
    adjustments: [],
    idleThresholdMinutes: idleThresholdMinutes ?? getIdleThreshold(),
    lastActivityAt: now,
  };
  data.entries.push(entry);
  return { entry, stoppedPrevious };
}

export function stopEntry(data: TrackData, ticketId?: string): TimeEntry {
  let entry: TimeEntry | undefined;
  if (ticketId) {
    entry = findEntry(data, ticketId);
    if (!entry) throw new Error(`No entry found for ${ticketId}`);
  } else {
    entry = findActiveEntry(data);
    if (!entry) throw new Error('No active entry to stop');
  }

  if (entry.status === 'completed') {
    throw new Error(`${entry.ticketId} is already completed`);
  }

  const now = new Date().toISOString();
  entry.stoppedAt = now;
  entry.status = 'completed';

  if (entry.pauses.length > 0) {
    const lastPause = entry.pauses[entry.pauses.length - 1];
    if (!lastPause.end) lastPause.end = now;
  }

  return entry;
}

export function pauseEntry(data: TrackData, ticketId?: string): TimeEntry {
  let entry: TimeEntry | undefined;
  if (ticketId) {
    entry = findEntry(data, ticketId);
  } else {
    entry = findActiveEntry(data);
  }

  if (!entry) throw new Error(ticketId ? `No entry found for ${ticketId}` : 'No active entry to pause');
  if (entry.status !== 'active') throw new Error(`${entry.ticketId} is not active (status: ${entry.status})`);

  entry.pauses.push({ start: new Date().toISOString() });
  entry.status = 'paused';
  entry.lastActivityAt = new Date().toISOString();
  return entry;
}

export function resumeEntry(data: TrackData, ticketId?: string): TimeEntry {
  let entry: TimeEntry | undefined;
  if (ticketId) {
    entry = findEntry(data, ticketId);
  } else {
    entry = data.entries.find((e) => e.status === 'paused');
  }

  if (!entry) throw new Error(ticketId ? `No entry found for ${ticketId}` : 'No paused entry to resume');
  if (entry.status !== 'paused') throw new Error(`${entry.ticketId} is not paused (status: ${entry.status})`);

  const lastPause = entry.pauses[entry.pauses.length - 1];
  if (lastPause && !lastPause.end) {
    lastPause.end = new Date().toISOString();
  }

  entry.status = 'active';
  entry.lastActivityAt = new Date().toISOString();
  return entry;
}

export function adjustEntry(
  data: TrackData,
  ticketId: string,
  minutes: number,
  reason?: string,
): TimeEntry {
  const entry = findEntry(data, ticketId);
  if (!entry) throw new Error(`No entry found for ${ticketId}`);
  entry.adjustments.push({ minutes, reason });
  return entry;
}

export function calculateNetTime(entry: TimeEntry): {
  totalMs: number;
  pauseMs: number;
  adjustMs: number;
  netMs: number;
  formatted: string;
} {
  const now = Date.now();
  const start = new Date(entry.startedAt).getTime();
  const end = entry.stoppedAt ? new Date(entry.stoppedAt).getTime() : now;
  const totalMs = end - start;

  const pauseMs = entry.pauses.reduce((sum, p) => {
    const pStart = new Date(p.start).getTime();
    const pEnd = p.end ? new Date(p.end).getTime() : now;
    return sum + (pEnd - pStart);
  }, 0);

  const adjustMs = entry.adjustments.reduce((sum, a) => sum + a.minutes * 60000, 0);
  const netMs = Math.max(0, totalMs - pauseMs + adjustMs);

  return {
    totalMs,
    pauseMs,
    adjustMs,
    netMs,
    formatted: formatMs(netMs),
  };
}

function formatMs(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export function formatEntry(entry: TimeEntry): string {
  const time = calculateNetTime(entry);
  const lines: string[] = [
    `Ticket: ${entry.ticketId}`,
    `Status: ${entry.status}`,
    `Started: ${entry.startedAt}`,
  ];

  if (entry.stoppedAt) lines.push(`Stopped: ${entry.stoppedAt}`);
  if (entry.pauses.length > 0) lines.push(`Pauses: ${entry.pauses.length}`);
  if (entry.adjustments.length > 0) {
    const totalAdj = entry.adjustments.reduce((s, a) => s + a.minutes, 0);
    lines.push(`Adjustments: ${totalAdj > 0 ? '+' : ''}${totalAdj}m`);
  }

  lines.push(`Total time: ${formatMs(time.totalMs)}`);
  lines.push(`Pause time: ${formatMs(time.pauseMs)}`);
  if (time.adjustMs !== 0) lines.push(`Adjust time: ${formatMs(time.adjustMs)}`);
  lines.push(`Net work time: ${time.formatted}`);

  return lines.join('\n');
}
