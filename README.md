# timetracker-mcp

MCP server for tracking work time per ticket. Designed to accurately log real time spent working with AI agents — start/stop/pause/resume tracking, idle detection, and manual time adjustments.

## Installation

Add to your MCP client config:

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

On macOS/Linux:

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

Start tracking time for a ticket. Automatically stops any currently active ticket.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ticketId` | string | yes | Ticket ID (e.g. ENGP-3571) |
| `idleThresholdMinutes` | number | no | Override idle threshold for this entry |

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
| `minutes` | number | yes | Minutes to adjust (positive to add, negative to subtract) |
| `reason` | string | no | Reason for adjustment |

### tracker_get

Get full tracking data for a ticket, including raw JSON.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ticketId` | string | yes | Ticket ID |

### tracker_status

Show what is currently being tracked. No parameters.

## Idle Detection

The server monitors inactivity between tool calls. If no activity is detected for longer than the threshold, it automatically pauses the entry and excludes idle time from the total.

- Default threshold: 60 minutes
- Configurable via `IDLE_THRESHOLD_MINUTES` env variable
- Can be overridden per entry via `idleThresholdMinutes` in `tracker_start`

The `lastActivityAt` timestamp updates on `resume`, `status`, and other interactions.

## Time Calculation

```
net = (stoppedAt - startedAt) - total_pauses + adjustments
```

- Pauses (manual and auto-idle) are subtracted
- Adjustments can add or subtract time
- Net time is never negative (floor at 0)

## Data Storage

Tracking data is stored in `{projectRoot}/.claude/timetrack.json`.

- Project root is determined via MCP roots or `PROJECT_DIR` env variable
- Completed entries older than 30 days are automatically cleaned up

## License

MIT
