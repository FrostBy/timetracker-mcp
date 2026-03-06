import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadData, saveData } from './storage.js';
import {
  startEntry,
  stopEntry,
  pauseEntry,
  resumeEntry,
  adjustEntry,
  findActiveEntry,
  findEntry,
  checkIdle,
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

function withIdleCheck(data: ReturnType<typeof loadData>): string[] {
  const warnings: string[] = [];
  const active = findActiveEntry(data);
  if (active) {
    const idleWarning = checkIdle(active);
    if (idleWarning) warnings.push(idleWarning);
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
  'Start tracking time for a ticket. Auto-stops any currently active ticket.',
  {
    ticketId: z.string().describe('Ticket ID (e.g. ENGP-3571)'),
    idleThresholdMinutes: z.number().optional().describe('Idle threshold in minutes (default from env or 60)'),
  },
  async (params) => {
    const root = await getProjectRoot(server);
    const data = loadData(root);

    try {
      const { entry, stoppedPrevious } = startEntry(data, params.ticketId, params.idleThresholdMinutes);
      saveData(root, data);

      const lines: string[] = [];
      if (stoppedPrevious) lines.push(`Auto-stopped: ${stoppedPrevious}`);
      lines.push(`Started tracking: ${entry.ticketId}`);
      lines.push(`Idle threshold: ${entry.idleThresholdMinutes}m`);

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${(e as Error).message}` }], isError: true };
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
    const warnings = withIdleCheck(data);

    try {
      const entry = stopEntry(data, params.ticketId);
      saveData(root, data);

      const lines = [...warnings, formatEntry(entry)];
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${(e as Error).message}` }], isError: true };
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
      return { content: [{ type: 'text' as const, text: `Error: ${(e as Error).message}` }], isError: true };
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
      touchActivity(entry);
      saveData(root, data);
      return { content: [{ type: 'text' as const, text: `Resumed: ${entry.ticketId}` }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Error: ${(e as Error).message}` }], isError: true };
    }
  },
);

// tracker_adjust
server.tool(
  'tracker_adjust',
  'Adjust tracked time for a ticket (+/- minutes).',
  {
    ticketId: z.string().describe('Ticket ID'),
    minutes: z.number().describe('Minutes to adjust (positive to add, negative to subtract)'),
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
      return { content: [{ type: 'text' as const, text: `Error: ${(e as Error).message}` }], isError: true };
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
    const warnings = withIdleCheck(data);

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
    const warnings = withIdleCheck(data);

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
