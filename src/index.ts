#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadData, saveData, readActivityPing } from './storage.js';
import {
  startEntry,
  stopEntry,
  pauseEntry,
  resumeEntry,
  adjustEntry,
  findActiveEntry,
  findEntry,
  checkIdle,
  closeLastPause,
  touchActivity,
  formatEntry,
  calculateNetTime,
} from './tracker.js';

let projectRoot: string | null = null;

async function getProjectRoot(server: McpServer): Promise<string> {
  if (projectRoot) return projectRoot;

  // Try to get roots from MCP client
  try {
    const rootsResult = await (server as any).server.listRoots();
    if (rootsResult?.roots?.length > 0) {
      const uri = rootsResult.roots[0].uri as string;
      // Convert file:///H:/path to H:/path
      projectRoot = uri.replace(/^file:\/\/\//, '');
      return projectRoot;
    }
  } catch {
    // Client may not support roots
  }

  // Fallback to env
  if (process.env.PROJECT_DIR) {
    projectRoot = process.env.PROJECT_DIR;
    return projectRoot;
  }

  throw new Error('Cannot determine project root. Set PROJECT_DIR env or ensure client supports MCP roots.');
}

function applyIdleCheck(data: ReturnType<typeof loadData>, root: string): string[] {
  const warnings: string[] = [];
  const active = findActiveEntry(data);
  if (active) {
    const pingActivity = readActivityPing(root);
    const idleWarning = checkIdle(active, pingActivity);
    if (idleWarning) {
      warnings.push(idleWarning);
      // Auto-resume: close idle pause and reactivate
      closeLastPause(active);
      active.status = 'active';
      active.lastActivityAt = new Date().toISOString();
      warnings.push(`Auto-resumed: ${active.ticketId}`);
    }
  }
  return warnings;
}

const server = new McpServer({
  name: 'timetracker',
  version: '1.0.0',
});

// tracker_start
server.tool(
  'tracker_start',
  'Start tracking time for a ticket. Auto-pauses any currently active ticket.',
  {
    ticketId: z.string().describe('Ticket ID (e.g. ENGP-3571)'),
    idleThresholdMinutes: z.number().positive().optional().describe('Idle threshold in minutes (default from env or 60)'),
  },
  async (params) => {
    const root = await getProjectRoot(server);
    const data = loadData(root);

    try {
      const { entry, pausedPrevious, resumed } = startEntry(data, params.ticketId, params.idleThresholdMinutes);
      saveData(root, data);

      const lines: string[] = [];
      if (pausedPrevious) lines.push(`Auto-paused: ${pausedPrevious}`);
      if (resumed) {
        lines.push(`Resumed tracking: ${entry.ticketId}`);
      } else {
        lines.push(`Started tracking: ${entry.ticketId}`);
      }
      lines.push(`Idle threshold: ${entry.idleThresholdMinutes}m`);

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${(e as Error)?.message ?? e}` }], isError: true };
    }
  },
);

// tracker_stop
server.tool(
  'tracker_stop',
  'Stop tracking time. Returns time summary.',
  {
    ticketId: z.string().optional().describe('Ticket ID (if omitted, stops current active)'),
  },
  async (params) => {
    const root = await getProjectRoot(server);
    const data = loadData(root);
    const warnings = applyIdleCheck(data, root);

    try {
      const entry = stopEntry(data, params.ticketId);
      saveData(root, data);

      const lines = [...warnings, formatEntry(entry)];
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${(e as Error)?.message ?? e}` }], isError: true };
    }
  },
);

// tracker_pause
server.tool(
  'tracker_pause',
  'Pause time tracking.',
  {
    ticketId: z.string().optional().describe('Ticket ID (if omitted, pauses current active)'),
  },
  async (params) => {
    const root = await getProjectRoot(server);
    const data = loadData(root);

    try {
      const entry = pauseEntry(data, params.ticketId);
      saveData(root, data);
      return { content: [{ type: 'text' as const, text: `Paused: ${entry.ticketId}` }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${(e as Error)?.message ?? e}` }], isError: true };
    }
  },
);

// tracker_resume
server.tool(
  'tracker_resume',
  'Resume paused time tracking.',
  {
    ticketId: z.string().optional().describe('Ticket ID (if omitted, resumes current paused)'),
  },
  async (params) => {
    const root = await getProjectRoot(server);
    const data = loadData(root);

    try {
      const entry = resumeEntry(data, params.ticketId);
      saveData(root, data);
      return { content: [{ type: 'text' as const, text: `Resumed: ${entry.ticketId}` }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${(e as Error)?.message ?? e}` }], isError: true };
    }
  },
);

// tracker_adjust
server.tool(
  'tracker_adjust',
  'Adjust tracked time for a ticket (+/- minutes).',
  {
    ticketId: z.string().describe('Ticket ID'),
    minutes: z.number().int().describe('Minutes to adjust (positive to add, negative to subtract)'),
    reason: z.string().optional().describe('Reason for adjustment'),
  },
  async (params) => {
    const root = await getProjectRoot(server);
    const data = loadData(root);

    try {
      const entry = adjustEntry(data, params.ticketId, params.minutes, params.reason);
      saveData(root, data);

      const sign = params.minutes > 0 ? '+' : '';
      const reasonText = params.reason ? ` (${params.reason})` : '';
      return {
        content: [{ type: 'text' as const, text: `Adjusted ${entry.ticketId}: ${sign}${params.minutes}m${reasonText}` }],
      };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${(e as Error)?.message ?? e}` }], isError: true };
    }
  },
);

// tracker_get
server.tool(
  'tracker_get',
  'Get full tracking data for a ticket.',
  {
    ticketId: z.string().describe('Ticket ID'),
  },
  async (params) => {
    const root = await getProjectRoot(server);
    const data = loadData(root);
    const warnings = applyIdleCheck(data, root);

    const entry = findEntry(data, params.ticketId);
    if (!entry) {
      return { content: [{ type: 'text' as const, text: `No entry found for ${params.ticketId}` }], isError: true };
    }

    // Save in case idle check modified data
    if (warnings.length > 0) saveData(root, data);

    const lines = [...warnings, formatEntry(entry), '', 'Raw data:', JSON.stringify(entry, null, 2)];
    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  },
);

// tracker_status
server.tool(
  'tracker_status',
  'Show current tracking status.',
  {},
  async () => {
    const root = await getProjectRoot(server);
    const data = loadData(root);
    const warnings = applyIdleCheck(data, root);

    const active = findActiveEntry(data);
    if (!active) {
      return { content: [{ type: 'text' as const, text: 'Nothing is being tracked.' }] };
    }

    touchActivity(active);
    saveData(root, data);

    const lines = [...warnings, formatEntry(active)];
    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  },
);

// tracker_ping
server.tool(
  'tracker_ping',
  'Lightweight activity ping. Updates lastActivityAt for idle detection. Use from hooks.',
  {},
  async () => {
    const root = await getProjectRoot(server);
    const data = loadData(root);
    const warnings = applyIdleCheck(data, root);

    const active = findActiveEntry(data);
    if (active) {
      touchActivity(active);
      saveData(root, data);
      return { content: [{ type: 'text' as const, text: [...warnings, `Ping: ${active.ticketId}`].join('\n') }] };
    }

    return { content: [{ type: 'text' as const, text: 'No active entry.' }] };
  },
);

// tracker_list
server.tool(
  'tracker_list',
  'List all tracked entries with optional filters.',
  {
    status: z.enum(['active', 'paused', 'completed']).optional().describe('Filter by status'),
    days: z.number().positive().optional().describe('Show entries from last N days (default 7)'),
  },
  async (params) => {
    const root = await getProjectRoot(server);
    const data = loadData(root);
    applyIdleCheck(data, root);
    saveData(root, data);

    const cutoff = Date.now() - (params.days ?? 7) * 24 * 60 * 60 * 1000;
    const filtered = data.entries.filter((e) => {
      if (params.status && e.status !== params.status) return false;
      return new Date(e.startedAt).getTime() > cutoff;
    });

    if (filtered.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No entries found.' }] };
    }

    const lines = filtered.map((e) => {
      const time = calculateNetTime(e);
      return `${e.ticketId} [${e.status}] ${time.formatted}`;
    });

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  },
);

// tracker_report
server.tool(
  'tracker_report',
  'Aggregated time report by ticket for a period.',
  {
    days: z.number().positive().optional().describe('Report period in days (default 7)'),
  },
  async (params) => {
    const root = await getProjectRoot(server);
    const data = loadData(root);
    applyIdleCheck(data, root);
    saveData(root, data);

    const cutoff = Date.now() - (params.days ?? 7) * 24 * 60 * 60 * 1000;
    const relevant = data.entries.filter((e) => new Date(e.startedAt).getTime() > cutoff);

    if (relevant.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No entries in this period.' }] };
    }

    const byTicket = new Map<string, number>();
    for (const e of relevant) {
      const { netMs } = calculateNetTime(e);
      byTicket.set(e.ticketId, (byTicket.get(e.ticketId) ?? 0) + netMs);
    }

    let totalMs = 0;
    const lines: string[] = [];
    for (const [ticketId, ms] of byTicket) {
      totalMs += ms;
      const h = Math.floor(ms / 3600000);
      const m = Math.round((ms % 3600000) / 60000);
      lines.push(`${ticketId}: ${h}h ${m}m`);
    }

    const totalH = Math.floor(totalMs / 3600000);
    const totalM = Math.round((totalMs % 3600000) / 60000);
    lines.push(`---`);
    lines.push(`Total: ${totalH}h ${totalM}m`);

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  },
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Timetracker MCP server running');
}

main().catch((e) => {
  console.error('Failed to start:', e);
  process.exit(1);
});
