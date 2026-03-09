import fs from 'node:fs';
import path from 'node:path';
import type { TrackData } from './types.js';

const TRACK_FILE = 'timetrack.json';
const ACTIVITY_PING_FILE = 'activity-ping.json';
const CLEANUP_DAYS = 30;

export function getTrackFilePath(projectRoot: string): string {
  return path.join(projectRoot, '.claude', TRACK_FILE);
}

export function loadData(projectRoot: string): TrackData {
  const filePath = getTrackFilePath(projectRoot);
  if (!fs.existsSync(filePath)) {
    return { entries: [] };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as TrackData;
    return cleanup(data);
  } catch (e) {
    console.error(`Failed to parse ${filePath}, resetting:`, e);
    return { entries: [] };
  }
}

export function saveData(projectRoot: string, data: TrackData): void {
  const filePath = getTrackFilePath(projectRoot);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function readActivityPing(projectRoot: string): string | null {
  const filePath = path.join(projectRoot, '.claude', ACTIVITY_PING_FILE);
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    return data.lastActivity ?? null;
  } catch {
    return null;
  }
}

export function cleanup(data: TrackData): TrackData {
  const cutoff = Date.now() - CLEANUP_DAYS * 24 * 60 * 60 * 1000;
  return {
    entries: data.entries.filter((entry) => {
      if (entry.status !== 'completed') return true;
      if (!entry.stoppedAt) return true;
      return new Date(entry.stoppedAt).getTime() > cutoff;
    }),
  };
}
