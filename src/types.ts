export interface Pause {
  start: string;
  end?: string;
}

export interface Adjustment {
  minutes: number;
  reason?: string;
}

export interface TimeEntry {
  ticketId: string;
  startedAt: string;
  stoppedAt?: string;
  status: 'active' | 'paused' | 'completed';
  pauses: Pause[];
  adjustments: Adjustment[];
  idleThresholdMinutes: number;
  lastActivityAt: string;
}

export interface TrackData {
  entries: TimeEntry[];
}
