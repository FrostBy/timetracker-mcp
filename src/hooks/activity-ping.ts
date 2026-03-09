#!/usr/bin/env node
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const pingFile = join(process.cwd(), '.claude', 'activity-ping.json');
const dir = dirname(pingFile);

if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

writeFileSync(pingFile, `{"lastActivity":"${new Date().toISOString()}"}`);
