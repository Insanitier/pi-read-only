# pi-read-only

A minimal Pi extension that adds a `/read-only` collaboration mode: the agent
can inspect files and run read-only shell commands, but file mutations are
blocked. Built by extracting the read-only tool policy from
[`@narumitw/pi-plan-mode`](https://www.npmjs.com/package/@narumitw/pi-plan-mode)
without the plan workflow.

## Usage

```
/read-only            Open the Read-Only mode menu
```

The menu uses pi's built-in selector style (divider lines, accent title,
SelectList with the built-in theme), rendered like pi's own /settings and
/model selectors, and offers:

- **Start / Stop read-only mode** — toggles the restricted mode. Entering
  snapshots the currently active tools and restores them on exit.
- **Configure read-only tools…** — a filterable list of every tool. It
  controls which tools stay available while read-only mode is active;
  toggling a tool applies immediately when the mode is active, otherwise at
  the next start. `edit`, `write`, and `update_plan` are always blocked and
  shown as unavailable. A tool an extension registered under several names with
  an identical definition (FFF's `ffgrep` alias of `grep`) is listed once.

## What gets restricted

While read-only mode is active:

- Active tools are limited to the selected set (default: the safe tools
  `read`, `bash`, `grep`, `find`, `ls`, matched by name so extension overrides
  such as FFF's `grep`/`find` count too).
- `edit`, `write`, and `update_plan` tool calls are blocked.
- `bash` uses a fail-closed policy: read-only command whitelist, no
  redirects, no shell expansion/substitution, no background jobs, no mutating
  commands (`rm`, `mv`, `chmod`, `chown`, `ln`, `tee`, `sudo`, `kill`, …),
  reviewed read-only `git`/`gh` subcommands, and selected checks such as
  `npm test`, `npm run typecheck`, and `cargo test`.
- The agent system prompt gains a Read-Only Mode instruction block.
- Extension and custom tools are disabled unless explicitly enabled in the
  selector (user opt-in at user risk). Exception: a tool that shadows a
  built-in name keeps that name's policy, so an overridden `grep`/`find` stays
  available while an overridden `edit`/`write` stays blocked.

State (active + tool selection) is persisted per session, so resume and
compaction keep the exact mode and selection. The statusline shows
`read-only active` while the mode is on.

This is extension-level risk reduction, not an OS sandbox.

## Install

```bash
pi install /path/to/pi-read-only
```

Requires Pi 0.80.6 or newer. The menu needs TUI or RPC mode.

## License

MIT. `src/tool-policy.ts` is extracted from `@narumitw/pi-plan-mode` (MIT).
