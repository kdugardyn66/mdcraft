# Changelog

## 0.2.0 — 2026-10-16

- MCP server for AI agents: `mdcraft-cli mcp` (stdio). Headless tools create, read, edit, inspect
  and export documents; `--connect [PORT]` adds `app_*` tools that drive a running window: editor
  text, cursor, and every command by id. `--root`, `--automation-read-root` and
  `--automation-write-root` keep the agent inside the folders you choose. See `docs/mcp.md`.
- Windows is no longer supported: macOS and Linux only. Removed the Windows packaging script,
  the Windows CI runner, the `.ico` icon and the Windows-only code paths; building for Windows
  now stops with a clear error.
- `mdcraft --control [PORT]` and `mdcraft-cli serve --control` let agents drive the window
  (loopback only, a token in a private control file; off by default).

## 0.1.0 — 2026-10-14

First version.

- Desktop app (tao + wry) and `mdcraft-cli`.
- WordCraft-style interface: ribbon (Home, Insert, Design, Slides, Review, View, contextual Table),
  File view (start page, templates, open, save as, info, print, export, options, about),
  command search, status bar with views and zoom, navigation pane with headings and slide thumbnails.
- MarkDown Live 0.7.1 renderer: GFM, Mermaid, Graphviz, PlantUML, Vega, Chart.js, Plotly, WaveDrom,
  KaTeX/MathJax + mhchem, CSV, `@import`, code chunks, media, 3D molecules, slides with notes.
- Additions to the renderer: `<!-- pagebreak -->`, front matter exposed for themes.
- 7 document themes and 7 slide themes; 10 slide layouts; page setup, watermark, numbered headings.
- 11 Word-style document templates and 8 PowerPoint-style deck templates.
- Slide show (F5), printing to paper/PDF, HTML export, copy as formatted text.
- Document recovery, recent and pinned documents, preferences.
