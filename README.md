# timetracker-mcp

MCP server + Claude Code plugin for tracking work time per ticket. Accurately logs real time spent working with AI agents — start/stop/pause/resume tracking, idle detection via hooks, and manual time adjustments.

## Installation

### As Claude Code plugin (recommended)

Includes MCP server + activity hooks for accurate idle detection.

```bash
claude plugin install github:FrostBy/timetracker-mcp
```

### Manual MCP setup

Without hooks — idle detection based only on timetracker tool calls.

Windows:

```json
{
  "timetracker": {
    "command": "cmd",
    "args": ["/c", "npx", "github:FrostBy/timetracker-mcp"],
    "env": {
      "IDLE_THRESHOLD_MINUTES": "60"
    }
  }
}
```

macOS/Linux:

```json
{
  "timetracker": {
    "command": "npx",
    "args": ["github:FrostBy/timetracker-mcp"],
    "env": {
      "IDLE_THRESHOLD_MINUTES": "60"
    }
  }
}
```

## Tools

### tracker_start

Start tracking time for a ticket. Auto-pauses any currently active ticket.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ticketId` | string | yes | Ticket ID (e.g. ENGP-3571) |
| `idleThresholdMinutes` | number | no | Override idle threshold for this entry |

- If the ticket is already active — returns current entry (idempotent)
- If the ticket is paused — resumes it
- If another ticket is active — auto-pauses it (not stops)

### tracker_stop

Stop tracking and get a time summary.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ticketId` | string | no | Ticket ID. If omitted, stops the current active entry |

Returns: total time, pause time, adjustments, net work time.

### tracker_pause

Pause time tracking.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ticketId` | string | no | Ticket ID. If omitted, pauses the current active entry |

### tracker_resume

Resume paused time tracking.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ticketId` | string | no | Ticket ID. If omitted, resumes the current paused entry |

### tracker_adjust

Adjust tracked time by adding or subtracting minutes.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ticketId` | string | yes | Ticket ID |
| `minutes` | number | yes | Whole minutes to adjust (positive to add, negative to subtract) |
| `reason` | string | no | Reason for adjustment |

### tracker_get

Get full tracking data for a ticket, including raw JSON.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ticketId` | string | yes | Ticket ID |

### tracker_status

Show what is currently being tracked. No parameters.

### tracker_ping

Lightweight activity ping. Updates `lastActivityAt` for idle detection. No output. Useful if not using the plugin hooks.

### tracker_list

List all tracked entries with optional filters.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `status` | string | no | Filter: `active`, `paused`, or `completed` |
| `days` | number | no | Show entries from last N days (default 7) |

### tracker_report

Aggregated time report by ticket for a period.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `days` | number | no | Report period in days (default 7) |

## Idle Detection

The server monitors inactivity and automatically pauses tracking when idle time exceeds the threshold.

### With plugin hooks (recommended)

When installed as a plugin, a `PreToolUse` hook fires on **every** tool call (Read, Edit, Bash, etc.) and writes a timestamp to `.claude/activity-ping.json`. The MCP server reads this file for idle detection — covering all agent activity, not just timetracker calls.

### Without hooks

Idle detection is based only on direct timetracker tool calls (`tracker_status`, `tracker_ping`, etc.).

### Configuration

- Default threshold: 60 minutes
- Configurable via `IDLE_THRESHOLD_MINUTES` env variable
- Can be overridden per entry via `idleThresholdMinutes` in `tracker_start`

### Auto-resume

When idle is detected and the user returns, the next tool call automatically resumes tracking — idle time is excluded, no manual resume needed.

## Time Calculation

```
net = (stoppedAt - startedAt) - total_pauses + adjustments
```

- Pauses (manual and auto-idle) are subtracted
- Adjustments can add or subtract time
- Net time is never negative (floor at 0)

## Ticket Switching

Starting a new ticket auto-pauses the current one (not stops). Switch back anytime with `tracker_start` — it resumes the paused ticket.

## Data Storage

Tracking data is stored in `{projectRoot}/.claude/timetrack.json`.

- Project root is determined via MCP roots or `PROJECT_DIR` env variable
- Completed entries older than 30 days are automatically cleaned up

## License

MIT
