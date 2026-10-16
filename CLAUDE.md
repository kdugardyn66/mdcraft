# mdcraft — instructions for agents and contributors

mdcraft is a Word-style Markdown editor: WordCraft's application design on top of MarkDown Live's
renderer, in a native window (tao + wry). Read `README.md` and `docs/templates.md` first.

## Never lose work
People trust mdcraft with their writing. This outranks feature work.
- No panics in non-test code of the apps and `mdcraft-templates` (`#![deny(clippy::unwrap_used, …)]`);
  return errors. Code inherited from MarkDown Live in `mdcraft-core` still uses `lock().unwrap()`
  on its own mutexes; don't add new unwraps.
- Files are written with `prefs::write_atomic`. Unsaved documents are autosaved for recovery
  (`/api/autosave`). Closing the window always goes through `MD.confirmDiscard()`.

## Everything is a command
User-visible actions are commands in `web/assets/commands.js` (`C('insert.chart', {...})`) with a
label, icon, optional shortcut, `run`, and `checked`/`enabled`. The ribbon (`ribbon.js`), keyboard
shortcuts and command search all dispatch by id. Add a command first, then put it on the ribbon. AI agents run the same commands through MCP
(`app_run_command`), so a command that takes `args` is usable by agents too.

## Where things are
| Path | What |
|---|---|
| `crates/mdcraft-core/src/{markdown,csv,diagrams,jobs,media,http,web,app}.rs` | MarkDown Live's renderer and server |
| `crates/mdcraft-core/src/{api,prefs,lib}.rs` | mdcraft's editor API, preferences, recovery |
| `crates/mdcraft-core/web/assets` | the UI: `app.html`, `app.css` (chrome), `themes.css` (document & slide themes), `editor.js`, `commands.js`, `ribbon.js`, `backstage.js`, `present.js`, `app.js` |
| `crates/mdcraft-templates` + `templates/` | templates |
| `apps/mdcraft` | desktop shell (IPC: `open-dialog`, `save-dialog`, `print`, `fullscreen`, `set-title`, `quit`, …) |
| `apps/mdcraft-cli/src/{mcp,live}.rs`, `crates/mdcraft-core/src/agent.rs`, `web/assets/agent.js` | the MCP server and the agent bridge (`--control` / `--connect`), see `docs/mcp.md` |

Web assets are embedded at build time: rebuild after changing them.

## Assets
No Microsoft (or other vendor) icons, images, templates or fonts. Icons are drawn in `icons.js`.
Every asset file gets a row in `ATTRIBUTION.md`. ArtCraft/WordCraft brand assets must not be used.

## Quality gates
`cargo clippy --workspace -- -D warnings` and `cargo test --workspace` before every commit.
Check UI changes visually: `mdcraft-cli serve --no-open` and a headless browser, or the app itself.
