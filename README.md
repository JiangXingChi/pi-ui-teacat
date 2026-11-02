# pi-ui-teacat

Three things on top of Pi's own screen:

1. **Process** — the thinking and the tool calls of one run, folded under a single line.
   Your question and the answer stay in view; the work between them does not.
2. **Now** — one line above the editor saying what is running right now: the tool, or the
   thought that is streaming. Click it open and each running tool gets its own row, with the
   last lines of the streaming thought under it.
3. **Footer** — `provider · model · thinking · token speed` on the left, the context bar and
   `used/window` pinned to the right edge of the terminal.

```
u. 10:31
why does this bug happen

▾ Process · 1 thought · 3 tools · 42s
  ↳ ▸ thinking 12s · comparing both diffs
  ↳ read  src/a.ts          184 lines
  ↳ bash  npm test          exit 1

p. 10:33
Fixed: a.ts was missing an await.

▸ Now · read src/a.ts · 3s
```

## Install

```bash
pi install git:github.com/JiangXingChi/pi-ui-teacat
pi install /path/to/pi-ui-teacat                  # local checkout
pi -e /path/to/pi-ui-teacat                       # one run, nothing written to settings
```

Restart Pi after installing.

## Keys and commands

| | |
| --- | --- |
| `Ctrl+O` | fold / unfold the whole Process block (Pi's own tools-expand key) |
| click the `Process` header | fold / unfold the whole block; works on a finished run too |
| click the `Now` row | open / close it: one row per running tool, then the last lines of a streaming thought (three, up to six in a tall window) |
| click a thinking row | open / close that block's thinking text (the block itself must be unfolded) |
| click a tool row | open that single row with Pi's own detail (the block must be unfolded); clicking anywhere on the open row folds just that row |
| `/ui` | switch Process, Now and the footer on or off (saved to disk) |
| `/process` | fold / unfold the Process block without touching the keybinding |

Settings live in `~/.pi/agent/pi-ui-teacat/settings.json`:

```json
{ "process": true, "now": true, "footer": true }
```

A missing file or key means on.

## How folding works

- The Process header belongs to the first assistant message of a run; the run is
  `agent_start` → `agent_settled`. Counts and the duration are live while it runs, and end
  as `✓ Process · …` when folded (or `! Process · … · 1 issue`); an open block shows `▾`.
- Thinking is folded to one row, `↳ ▸ thinking 12.4s · its newest sentence`; clicking that row
  opens the whole text under it and clicking again closes it, the same bargain a tool row
  offers. The preview is the tail of the last line, dropped at very narrow widths. The duration
  is written to the session as a `pi-ui-teacat-thought` entry, so a resumed session shows the same
  numbers.
- Tool rows are drawn by this extension while folded, and are handed back to Pi's own
  renderer when a row is opened: diffs, syntax highlighting, images and truncation notices
  are Pi's, not ours.
- Anything not drawn by this extension is untouched: non-interactive modes, `print`, `json`
  and `rpc` never take the patched path.

## Limits worth knowing

- Folding needs Pi's own hidden-thinking mode: with `hideThinkingBlock: false` a message
  keeps Pi's native thinking rendering, gets no Process header, and its tool rows stay Pi's
  own (nothing is folded, nothing disappears).
- A one-second timer keeps the live duration and the Now row's seconds moving. It resets only
  the header line it has to draw, so no message is rebuilt; with nothing running and no Now
  row it draws nothing.
- Streaming text repaints at most ten times a second, and a tool or thinking row only redraws
  for the run it belongs to, so a long transcript is not rebuilt while a tool starts.
- An open Now row draws at most nine lines (Pi's widget area is capped at ten); it counts as
  one line while folded.
- Counts for a resumed session are reconstructed from the messages on the branch; thinking
  durations come from the entries this extension wrote (older sessions show none).
- Several thinking blocks inside one message share one `thinking` row: the durations are
  merged and the texts are shown together when unfolded.
- Nested tool calls (a tool that runs other tools, e.g. codemode) stay inside their parent
  row; they do not become rows of their own.
- The thinking body is rendered without Pi's markdown transformers (Mermaid blocks fall back
  to code).
- Two extensions patching the same Pi component fight; this one only patches while its
  Process switch is on and leaves the originals in place to restore.

## Development

```bash
npm install                     # typescript + @types/node only; Pi itself is the peer
./node_modules/.bin/tsc --noEmit
node tests/load-check.mjs       # headless: fake Pi API, real Pi components, fake clock
```

No build step: Pi loads the TypeScript entry directly.

## Credits

Built on ideas and API research from [`prjct-app/pi-ui`](https://github.com/prjct-app/pi-ui)
(MIT). The code here is its own, but the approach — patching Pi's exported message
components and keeping every part switchable — comes from that project.

## Layout

```
index.ts                assembly: settings, footer, process, /ui
src/settings.ts         switches in ~/.pi/agent/pi-ui-teacat/settings.json
src/format.ts           verbs, targets, outcomes, durations, width helpers
src/metrics.ts          token speed: live estimate, exact on message_end
src/footer.ts           left group + right-aligned context; drops bar, then provider
src/process/index.ts    events → state → redraw
src/process/state.ts    runs, thoughts, tool rows; rebuild from the session branch
src/process/patch.ts    idempotent patches on Pi's message components
src/process/render.ts   Process header, child rows, Now line
src/process/now.ts      the above-editor widget
src/ui.ts               /ui checklist
tests/load-check.mjs    headless wiring test (fake Pi API, real components)
```