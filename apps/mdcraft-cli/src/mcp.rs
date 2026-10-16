//! `mdcraft-cli mcp`: a Model Context Protocol server over stdio for AI agents
//! (Claude Code, Gemini CLI, Codex, Claude Desktop …).
//!
//! Headless, it creates, reads, edits, inspects and exports Markdown documents and decks
//! on disk. With `--connect [PORT]` it also drives a running mdcraft window
//! (`mdcraft --control`): the editor's text, the cursor, and every ribbon command by id.
//!
//! ```text
//! mdcraft-cli mcp                                    headless documents
//! mdcraft-cli mcp --root DIR                         read and write only below DIR
//! mdcraft-cli mcp --automation-read-root DIR --automation-write-root DIR
//! mdcraft-cli mcp --connect [PORT]                   …and drive the running app
//! ```
//!
//! JSON-RPC 2.0, one message per line on stdin/stdout; logs go to stderr.

use crate::live::{Live, Target};
use mdcraft_core::{api, markdown, prefs, templates, util};
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

const PROTOCOLS: &[&str] = &["2025-06-18", "2025-03-26", "2024-11-05"];
const GUIDE: &str = include_str!("../../../docs/templates.md");
/// Rendered HTML and document text longer than this are cut (agents' context is precious).
const MAX_OUT: usize = 200_000;

const INSTRUCTIONS: &str = "mdcraft writes Word-style documents and PowerPoint-style decks in Markdown. \
Call `guide` once to learn the building blocks (front matter themes, cover pages, KPI cards, columns, callouts, \
charts, diagrams, slide separators and layouts). Start new files from a template (`list_templates`, \
`create_document`), then edit them with `edit_document` / `write_document`, and check the result with \
`inspect_document` (outline, slides, front matter, word count) instead of reading HTML. \
When the app_* tools are present, a mdcraft window is connected: `app_state` first; `app_list_commands` and \
`app_run_command` run the same commands as the ribbon. Unsaved work is never discarded: save with `app_save` \
before opening or creating another document.";

// ------------------------------------------------------------------ options

#[derive(Default)]
pub struct Options {
    read_roots: Vec<PathBuf>,
    write_roots: Vec<PathBuf>,
    connect: Option<Target>,
}

pub fn parse_args(args: &[String]) -> Result<Options, String> {
    let mut o = Options::default();
    let mut i = 0;
    let dir = |v: Option<&String>, flag: &str| -> Result<PathBuf, String> {
        let v = v.ok_or_else(|| format!("{flag} needs a folder"))?;
        let p = util::norm_path(&expand(v));
        let p = std::fs::canonicalize(&p).map_err(|e| format!("{flag} {}: {e}", p.display()))?;
        if !p.is_dir() {
            return Err(format!("{flag} {}: not a folder", p.display()));
        }
        Ok(p)
    };
    while i < args.len() {
        let a = args.get(i).map(|s| s.as_str()).unwrap_or("");
        match a {
            "--root" => {
                i += 1;
                let d = dir(args.get(i), a)?;
                o.read_roots.push(d.clone());
                o.write_roots.push(d);
            }
            "--automation-read-root" => {
                i += 1;
                o.read_roots.push(dir(args.get(i), a)?);
            }
            "--automation-write-root" => {
                i += 1;
                o.write_roots.push(dir(args.get(i), a)?);
            }
            "--connect" => {
                let next = args.get(i + 1).filter(|n| !n.starts_with("--"));
                if next.is_some() {
                    i += 1;
                }
                o.connect = Some(Target::parse(next.map(|s| s.as_str()))?);
            }
            "--help" | "-h" => return Err(HELP.to_string()),
            other => return Err(format!("unknown option `{other}`\n\n{HELP}")),
        }
        i += 1;
    }
    Ok(o)
}

pub const HELP: &str = "mdcraft-cli mcp — an MCP server for AI agents (stdio)

  mdcraft-cli mcp [--root DIR] [--automation-read-root DIR] [--automation-write-root DIR] [--connect [PORT]]

  --root DIR                    read and write only below DIR (repeatable)
  --automation-read-root DIR    agents may read below DIR (repeatable)
  --automation-write-root DIR   agents may write below DIR (repeatable; also readable)
  --connect [PORT]              also drive a running window started with `mdcraft --control [PORT]`
                                (without PORT: the most recently started one)

  claude mcp add mdcraft -- mdcraft-cli mcp --root ~/Documents
  claude mcp add mdcraft-app -- mdcraft-cli mcp --connect
";

fn expand(p: &str) -> PathBuf {
    let p = p.trim();
    if let Some(rest) = p.strip_prefix("~/") {
        if let Some(h) = util::home_dir() {
            return h.join(rest);
        }
    }
    if p == "~" {
        if let Some(h) = util::home_dir() {
            return h;
        }
    }
    PathBuf::from(p)
}

// ------------------------------------------------------------------ the sandbox

struct Server {
    o: Options,
    live: Option<Live>,
}

/// `p` made absolute and canonical; for a file that doesn't exist yet, its nearest
/// existing folder is canonicalized and the rest appended (no `..` allowed in the rest).
fn resolve(p: &Path) -> Result<PathBuf, String> {
    let abs = util::norm_path(p);
    if let Ok(c) = std::fs::canonicalize(&abs) {
        return Ok(c);
    }
    let mut tail = Vec::new();
    let mut cur = abs.as_path();
    loop {
        if let Ok(c) = std::fs::canonicalize(cur) {
            let mut out = c;
            for part in tail.iter().rev() {
                out.push(part);
            }
            return Ok(out);
        }
        let name = cur.file_name().ok_or_else(|| format!("{}: no such folder", abs.display()))?;
        tail.push(name.to_os_string());
        cur = cur.parent().ok_or_else(|| format!("{}: no such folder", abs.display()))?;
    }
}

impl Server {
    fn path(&self, args: &Value, key: &str) -> Result<PathBuf, String> {
        let s = args[key].as_str().filter(|s| !s.trim().is_empty()).ok_or_else(|| format!("`{key}` is required"))?;
        let p = expand(s);
        let p = if p.is_relative() {
            match self.o.write_roots.first().or(self.o.read_roots.first()) {
                Some(root) => root.join(p),
                None => p,
            }
        } else {
            p
        };
        resolve(&p)
    }

    fn can_read(&self, p: &Path) -> Result<(), String> {
        if self.o.read_roots.is_empty() && self.o.write_roots.is_empty() {
            return Ok(());
        }
        if self.o.read_roots.iter().chain(self.o.write_roots.iter()).any(|r| p.starts_with(r)) {
            return Ok(());
        }
        Err(format!("{} is outside the folders this agent may read", p.display()))
    }

    fn can_write(&self, p: &Path) -> Result<(), String> {
        if self.o.read_roots.is_empty() && self.o.write_roots.is_empty() {
            return Ok(());
        }
        if self.o.write_roots.iter().any(|r| p.starts_with(r)) {
            return Ok(());
        }
        Err(format!("{} is outside the folders this agent may write", p.display()))
    }

    fn read_path(&self, args: &Value, key: &str) -> Result<PathBuf, String> {
        let p = self.path(args, key)?;
        self.can_read(&p)?;
        Ok(p)
    }

    fn write_path(&self, args: &Value, key: &str) -> Result<PathBuf, String> {
        let p = self.path(args, key)?;
        self.can_write(&p)?;
        if p.is_dir() {
            return Err(format!("{} is a folder", p.display()));
        }
        Ok(p)
    }

    fn live(&self) -> Result<&Live, String> {
        self.live.as_ref().ok_or_else(|| "not connected to a mdcraft window: start the server with --connect".into())
    }
}

// ------------------------------------------------------------------ helpers

fn read_text(p: &Path) -> Result<String, String> {
    let bytes = std::fs::read(p).map_err(|e| format!("{}: {e}", p.display()))?;
    let text = String::from_utf8(bytes).map_err(|_| format!("{} is not a UTF-8 text file", p.display()))?;
    Ok(text.strip_prefix('\u{feff}').map(|s| s.to_string()).unwrap_or(text))
}

/// Renders without running code chunks: an agent's document never executes code.
fn render(text: &str, file: &Path) -> markdown::Rendered {
    let settings = prefs::render_settings();
    let mut ctx = markdown::Ctx::new(&settings, file.to_path_buf(), vec![]);
    ctx.sourcepos = false;
    ctx.allow_scripts = false;
    markdown::render(text, &ctx)
}

fn word_count(text: &str) -> usize {
    let body = strip_front_matter(text);
    body.split(|c: char| !(c.is_alphanumeric() || c == '\'' || c == '’' || c == '-')).filter(|w| w.chars().any(|c| c.is_alphanumeric())).count()
}

fn strip_front_matter(text: &str) -> &str {
    if let Some(rest) = text.strip_prefix("---\n").or_else(|| text.strip_prefix("---\r\n")) {
        for end in ["\n---\n", "\n---\r\n", "\n...\n"] {
            if let Some(i) = rest.find(end) {
                return &rest[i + end.len()..];
            }
        }
    }
    text
}

fn cut(s: &str, max: usize) -> (String, bool) {
    if s.len() <= max {
        return (s.to_string(), false);
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    (s[..end].to_string(), true)
}

fn inspect(text: &str, file: &Path) -> Value {
    let r = render(text, file);
    let meta: serde_json::Map<String, Value> = r.meta.into_iter().map(|(k, v)| (k, Value::String(v))).collect();
    json!({
        "path": file.to_string_lossy(),
        "title": r.title,
        "kind": if r.slides > 0 { "presentation" } else { "document" },
        "slides": slide_count(&r.html),
        "frontMatter": meta,
        "outline": r.headings.iter().map(|h| json!({"level": h.level, "text": h.text, "line": h.line + 1})).collect::<Vec<_>>(),
        "words": word_count(text),
        "lines": text.lines().count(),
    })
}

/// Slides the renderer shows (empty ones, e.g. before the first marker, are skipped).
fn slide_count(html: &str) -> usize {
    html.matches("class=\"ml-slide-wrap\"").count()
}

fn s<'a>(args: &'a Value, k: &str) -> Option<&'a str> {
    args[k].as_str()
}

// ------------------------------------------------------------------ tools

fn tool(name: &str, description: &str, props: Value, required: &[&str], read_only: bool) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": {"type": "object", "properties": props, "required": required},
        "annotations": {"readOnlyHint": read_only},
    })
}

fn tools(live: bool) -> Vec<Value> {
    let path = json!({"type": "string", "description": "File path (absolute, ~/…, or relative to the first allowed folder)"});
    let mut t = vec![
        tool("guide", "How mdcraft documents and decks are written: front matter and themes, cover pages, KPI cards, columns, callouts, charts, diagrams, slides and layouts. Read once before writing.", json!({}), &[], true),
        tool("list_templates", "The templates for new documents (Word-style) and presentations (PowerPoint-style).", json!({"search": {"type": "string", "description": "Optional filter"}}), &[], true),
        tool("create_document", "Create a new Markdown file from a template (author, dates filled in). Refuses to overwrite.", json!({
            "template": {"type": "string", "description": "Template id from list_templates, e.g. report, letter, pitch, blank, blank-deck"},
            "path": path,
        }), &["template", "path"], false),
        tool("read_document", "Read a Markdown file, optionally a range of lines (1-based).", json!({
            "path": path, "fromLine": {"type": "integer"}, "toLine": {"type": "integer"},
        }), &["path"], true),
        tool("write_document", "Write a whole Markdown file (atomic). Replacing an existing file needs overwrite: true.", json!({
            "path": path, "text": {"type": "string"}, "overwrite": {"type": "boolean", "default": false},
        }), &["path", "text"], false),
        tool("edit_document", "Replace text in a Markdown file: the first occurrence of `find`, or every one with all: true. Fails when `find` is missing.", json!({
            "path": path, "find": {"type": "string"}, "replace": {"type": "string"}, "all": {"type": "boolean", "default": false},
        }), &["path", "find", "replace"], false),
        tool("inspect_document", "Check a document without screenshots: title, document or deck, slide count, front matter (theme…), outline with line numbers, word count.", json!({
            "path": path, "text": {"type": "string", "description": "Inspect this text instead of the file's (the file need not exist)"},
        }), &["path"], true),
        tool("render_html", "The rendered HTML fragment of a document (diagrams and math are finished in a browser). Prefer inspect_document.", json!({
            "path": path, "maxChars": {"type": "integer", "default": 50000},
        }), &["path"], true),
        tool("export_html", "Export a document as a standalone web page.", json!({
            "path": path, "out": {"type": "string", "description": "Output .html (default: next to the document)"},
        }), &["path"], false),
        tool("list_files", "List Markdown files and folders in a folder.", json!({
            "dir": {"type": "string", "description": "Folder (default: the first allowed folder, or Documents)"},
            "all": {"type": "boolean", "description": "Every file, not only Markdown"},
        }), &[], true),
    ];
    if live {
        t.extend([
            tool("app_state", "The connected mdcraft window: open document (path, saved, unsaved changes), view, ribbon tab, cursor, selection, deck or document, theme, front matter, statistics.", json!({}), &[], true),
            tool("app_get_text", "The Markdown in the window's editor (including unsaved changes), optionally a range of lines.", json!({"fromLine": {"type": "integer"}, "toLine": {"type": "integer"}}), &[], true),
            tool("app_set_text", "Replace the editor's whole text as one undoable edit (Ctrl+Z undoes it). Opens a blank document when none is open.", json!({"text": {"type": "string"}}), &["text"], false),
            tool("app_insert", "Type text at the cursor (replacing the selection), or as a block on its own lines (block: true), or at the end (atEnd: true).", json!({
                "text": {"type": "string"}, "block": {"type": "boolean"}, "atEnd": {"type": "boolean"},
            }), &["text"], false),
            tool("app_replace", "Replace text in the editor (first occurrence, or all: true) as one undoable edit.", json!({
                "find": {"type": "string"}, "replace": {"type": "string"}, "all": {"type": "boolean"},
            }), &["find", "replace"], false),
            tool("app_select", "Move the cursor / select: find text, go to a line (1-based, selectLine to select it), or select all.", json!({
                "find": {"type": "string"}, "line": {"type": "integer"}, "selectLine": {"type": "boolean"}, "all": {"type": "boolean"},
            }), &[], false),
            tool("app_list_commands", "The window's commands (every ribbon button, shortcut and menu item) with id, label, shortcut, enabled/checked.", json!({"search": {"type": "string"}}), &[], true),
            tool("app_run_command", "Run a command by id, as the ribbon would: format.bold, insert.chart, design.theme, slides.present … Commands act on the selection. Some open a dialog for the user.", json!({
                "id": {"type": "string"}, "args": {"description": "Optional arguments for commands that take them"},
                "timeoutSeconds": {"type": "integer", "default": 30},
            }), &["id"], false),
            tool("app_new_document", "Start a new document in the window from a template. Refused while the open document has unsaved changes.", json!({"template": {"type": "string", "default": "blank"}}), &[], false),
            tool("app_open_document", "Open a Markdown file in the window. Refused while the open document has unsaved changes.", json!({"path": path}), &["path"], false),
            tool("app_save", "Save the window's document (to its file, or to `path` for a new document / Save As).", json!({"path": {"type": "string"}}), &[], false),
            tool("app_set_view", "Show the editor only (write), editor and preview (split), or the preview only (read).", json!({"view": {"type": "string", "enum": ["write", "split", "read"]}}), &["view"], false),
            tool("app_inspect", "The window's rendered document: title, outline, slide count, front matter, render time, blocks still rendering; html: true adds the HTML.", json!({"html": {"type": "boolean"}}), &[], true),
        ]);
    }
    t
}

impl Server {
    fn call(&self, name: &str, a: &Value) -> Result<Value, String> {
        match name {
            "guide" => Ok(json!({"guide": GUIDE})),
            "list_templates" => {
                let list: Vec<&templates::Template> = match s(a, "search").filter(|q| !q.trim().is_empty()) {
                    Some(q) => templates::search(q),
                    None => templates::all().iter().collect(),
                };
                Ok(
                    json!({"templates": list.iter().map(|t| json!({"id": t.id, "name": t.name, "kind": t.kind, "description": t.description})).collect::<Vec<_>>()}),
                )
            }
            "create_document" => {
                let id = s(a, "template").ok_or("`template` is required")?;
                let t = templates::get(id).ok_or_else(|| format!("no template `{id}` (list_templates shows them)"))?;
                let p = self.write_path(a, "path")?;
                if p.exists() {
                    return Err(format!("{} already exists", p.display()));
                }
                let text = templates::instantiate(t, &api::template_vars());
                if let Some(dir) = p.parent() {
                    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
                }
                prefs::write_atomic(&p, text.as_bytes()).map_err(|e| format!("{}: {e}", p.display()))?;
                Ok(json!({"created": p.to_string_lossy(), "template": t.id, "text": text}))
            }
            "read_document" => {
                let p = self.read_path(a, "path")?;
                let text = read_text(&p)?;
                let total = text.lines().count();
                let (from, to) =
                    (a["fromLine"].as_u64().unwrap_or(1).max(1) as usize, a["toLine"].as_u64().map(|n| n as usize).unwrap_or(total).min(total));
                let body = if from > 1 || to < total {
                    text.lines().skip(from - 1).take(to.saturating_sub(from - 1)).collect::<Vec<_>>().join("\n")
                } else {
                    text
                };
                let (body, truncated) = cut(&body, MAX_OUT);
                Ok(json!({"path": p.to_string_lossy(), "text": body, "totalLines": total, "truncated": truncated}))
            }
            "write_document" => {
                let p = self.write_path(a, "path")?;
                let text = s(a, "text").ok_or("`text` is required")?;
                if p.exists() && a["overwrite"].as_bool() != Some(true) {
                    return Err(format!("{} exists: pass overwrite: true to replace it", p.display()));
                }
                if let Some(dir) = p.parent() {
                    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
                }
                prefs::write_atomic(&p, text.as_bytes()).map_err(|e| format!("{}: {e}", p.display()))?;
                Ok(json!({"written": p.to_string_lossy(), "bytes": text.len()}))
            }
            "edit_document" => {
                let p = self.write_path(a, "path")?;
                let find = s(a, "find").filter(|f| !f.is_empty()).ok_or("`find` is required")?;
                let rep = s(a, "replace").unwrap_or("");
                let text = read_text(&p)?;
                let n = text.matches(find).count();
                if n == 0 {
                    return Err(format!("`{find}` was not found in {}", p.display()));
                }
                let all = a["all"].as_bool() == Some(true);
                let out = if all { text.replace(find, rep) } else { text.replacen(find, rep, 1) };
                prefs::write_atomic(&p, out.as_bytes()).map_err(|e| format!("{}: {e}", p.display()))?;
                Ok(json!({"edited": p.to_string_lossy(), "replaced": if all { n } else { 1 }, "occurrences": n}))
            }
            "inspect_document" => {
                let p = self.read_path(a, "path")?;
                let text = match s(a, "text") {
                    Some(t) => t.to_string(),
                    None => read_text(&p)?,
                };
                Ok(inspect(&text, &p))
            }
            "render_html" => {
                let p = self.read_path(a, "path")?;
                let r = render(&read_text(&p)?, &p);
                let (html, truncated) = cut(&r.html, a["maxChars"].as_u64().unwrap_or(50_000) as usize);
                Ok(json!({"html": html, "truncated": truncated}))
            }
            "export_html" => {
                let p = self.read_path(a, "path")?;
                let out = if a["out"].as_str().is_some() { self.write_path(a, "out")? } else { p.with_extension("html") };
                self.can_write(&out)?;
                let r = render(&read_text(&p)?, &p);
                prefs::write_atomic(&out, mdcraft_core::standalone_html(&r).as_bytes()).map_err(|e| format!("{}: {e}", out.display()))?;
                Ok(json!({"exported": out.to_string_lossy()}))
            }
            "list_files" => {
                let dir = if s(a, "dir").is_some() {
                    self.read_path(a, "dir")?
                } else {
                    self.o.write_roots.first().or(self.o.read_roots.first()).cloned().unwrap_or_else(util::documents_dir)
                };
                let all = a["all"].as_bool() == Some(true);
                let mut entries = Vec::new();
                for e in std::fs::read_dir(&dir).map_err(|e| format!("{}: {e}", dir.display()))?.flatten() {
                    let name = e.file_name().to_string_lossy().to_string();
                    if name.starts_with('.') {
                        continue;
                    }
                    let is_dir = e.path().is_dir();
                    let ext = markdown::ext_of(&name);
                    if !(is_dir || all || matches!(ext.as_str(), "md" | "markdown" | "mdown" | "mkd")) {
                        continue;
                    }
                    entries.push(json!({"name": name, "dir": is_dir, "path": e.path().to_string_lossy()}));
                }
                entries.sort_by(|x, y| x["name"].as_str().unwrap_or("").cmp(y["name"].as_str().unwrap_or("")));
                Ok(json!({"dir": dir.to_string_lossy(), "entries": entries}))
            }

            // ---------------------------------------------- the running window
            "app_state" => self.live()?.call("state", json!({}), Duration::from_secs(15)),
            "app_get_text" => {
                let mut v = self.live()?.call("get_text", a.clone(), Duration::from_secs(15))?;
                if let Some(t) = v["text"].as_str() {
                    let (t, truncated) = cut(t, MAX_OUT);
                    v["text"] = json!(t);
                    v["truncated"] = json!(truncated);
                }
                Ok(v)
            }
            "app_set_text" => self.live()?.call("set_text", a.clone(), Duration::from_secs(30)),
            "app_insert" => self.live()?.call("insert", a.clone(), Duration::from_secs(15)),
            "app_replace" => self.live()?.call("replace", a.clone(), Duration::from_secs(15)),
            "app_select" => self.live()?.call("select", a.clone(), Duration::from_secs(15)),
            "app_list_commands" => self.live()?.call("list_commands", a.clone(), Duration::from_secs(15)),
            "app_run_command" => {
                let secs = a["timeoutSeconds"].as_u64().unwrap_or(30).clamp(1, 300);
                self.live()?.call("run_command", a.clone(), Duration::from_secs(secs))
            }
            "app_new_document" => self.live()?.call("new_document", a.clone(), Duration::from_secs(30)),
            "app_open_document" => {
                let p = self.read_path(a, "path")?;
                self.live()?.call("open_document", json!({"path": p.to_string_lossy()}), Duration::from_secs(30))
            }
            "app_save" => {
                let args = if s(a, "path").is_some() { json!({"path": self.write_path(a, "path")?.to_string_lossy()}) } else { json!({}) };
                if !self.o.write_roots.is_empty() || !self.o.read_roots.is_empty() {
                    // saving to the document's own path must stay inside the allowed folders too
                    let st = self.live()?.call("state", json!({}), Duration::from_secs(15))?;
                    let target =
                        args["path"].as_str().or(st["path"].as_str()).map(PathBuf::from).ok_or("this document has never been saved: give a path")?;
                    self.can_write(&resolve(&target)?)?;
                }
                self.live()?.call("save", args, Duration::from_secs(30))
            }
            "app_set_view" => self.live()?.call("set_view", a.clone(), Duration::from_secs(15)),
            "app_inspect" => {
                let mut v = self.live()?.view()?;
                let html = a["html"].as_bool() == Some(true);
                let obj = v.as_object_mut().ok_or("unexpected answer from the window")?;
                for k in ["settings", "printRequest", "newestTab", "focus", "cursorSeq", "version_server"] {
                    obj.remove(k);
                }
                let full = obj.remove("html").and_then(|h| h.as_str().map(|h| h.to_string())).unwrap_or_default();
                obj.insert("slides".into(), json!(slide_count(&full)));
                if html {
                    obj.insert("html".into(), json!(cut(&full, MAX_OUT).0));
                }
                Ok(v)
            }
            other => Err(format!("unknown tool `{other}`")),
        }
    }

    fn handle(&self, msg: &Value) -> Option<Value> {
        let id = msg.get("id").cloned();
        let method = msg["method"].as_str().unwrap_or("");
        let params = &msg["params"];
        let result: Result<Value, (i64, String)> = match method {
            "initialize" => {
                let asked = params["protocolVersion"].as_str().unwrap_or("");
                let version = PROTOCOLS.iter().find(|v| **v == asked).copied().unwrap_or(PROTOCOLS[0]);
                Ok(json!({
                    "protocolVersion": version,
                    "capabilities": {"tools": {"listChanged": false}},
                    "serverInfo": {"name": "mdcraft", "title": "mdcraft", "version": env!("CARGO_PKG_VERSION")},
                    "instructions": INSTRUCTIONS,
                }))
            }
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({"tools": tools(self.live.is_some())})),
            "tools/call" => {
                let name = params["name"].as_str().unwrap_or("");
                let args = params.get("arguments").cloned().filter(|v| v.is_object()).unwrap_or_else(|| json!({}));
                Ok(match self.call(name, &args) {
                    Ok(v) => json!({
                        "content": [{"type": "text", "text": serde_json::to_string_pretty(&v).unwrap_or_default()}],
                        "isError": false,
                    }),
                    Err(e) => json!({"content": [{"type": "text", "text": e}], "isError": true}),
                })
            }
            "resources/list" => Ok(json!({"resources": []})),
            "resources/templates/list" => Ok(json!({"resourceTemplates": []})),
            "prompts/list" => Ok(json!({"prompts": []})),
            m if m.starts_with("notifications/") => return None,
            m => Err((-32601, format!("method not found: {m}"))),
        };
        let id = id?; // a notification gets no answer
        Some(match result {
            Ok(r) => json!({"jsonrpc": "2.0", "id": id, "result": r}),
            Err((code, message)) => json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}}),
        })
    }
}

/// Serves MCP on stdin/stdout until stdin closes.
pub fn run(args: &[String]) -> Result<(), String> {
    let o = parse_args(args)?;
    let live = o.connect.clone().map(|target| Live { target });
    let server = Server { o, live };
    eprintln!(
        "mdcraft MCP server {} ({}){}",
        env!("CARGO_PKG_VERSION"),
        if server.live.is_some() { "headless + connected window" } else { "headless" },
        if server.o.write_roots.is_empty() && server.o.read_roots.is_empty() { "" } else { ", confined to the allowed folders" }
    );
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = line.map_err(|e| format!("stdin: {e}"))?;
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(Value::Array(batch)) => {
                let r: Vec<Value> = batch.iter().filter_map(|m| server.handle(m)).collect();
                if r.is_empty() {
                    None
                } else {
                    Some(Value::Array(r))
                }
            }
            Ok(msg) => server.handle(&msg),
            Err(e) => Some(json!({"jsonrpc": "2.0", "id": null, "error": {"code": -32700, "message": format!("parse error: {e}")}})),
        };
        if let Some(r) = reply {
            writeln!(out, "{r}").and_then(|_| out.flush()).map_err(|e| format!("stdout: {e}"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server(root: &Path) -> Server {
        let r = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
        Server { o: Options { read_roots: vec![], write_roots: vec![r], connect: None }, live: None }
    }

    #[test]
    fn create_inspect_edit() {
        let dir = std::env::temp_dir().join(format!("mdcraft-mcp-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let s = server(&dir);
        let r = s.call("create_document", &json!({"template": "report", "path": "q3.md"}));
        assert!(r.is_ok(), "{r:?}");
        assert!(s.call("create_document", &json!({"template": "report", "path": "q3.md"})).is_err());
        let i = s.call("inspect_document", &json!({"path": "q3.md"})).unwrap_or_default();
        assert_eq!(i["kind"], "document");
        assert!(i["outline"].as_array().map(|a| !a.is_empty()).unwrap_or(false));
        assert!(s.call("write_document", &json!({"path": "q3.md", "text": "x"})).is_err());
        assert!(s.call("write_document", &json!({"path": "deck.md", "text": "# A\n\n<!-- slide -->\n\n# B\n"})).is_ok());
        let d = s.call("inspect_document", &json!({"path": "deck.md"})).unwrap_or_default();
        assert_eq!(d["kind"], "presentation");
        assert_eq!(d["slides"], 2);
        assert!(s.call("edit_document", &json!({"path": "deck.md", "find": "# B", "replace": "# Bee"})).is_ok());
        assert!(s.call("edit_document", &json!({"path": "deck.md", "find": "nope", "replace": ""})).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn confinement() {
        let dir = std::env::temp_dir().join(format!("mdcraft-mcp-c-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let s = server(&dir);
        assert!(s.call("write_document", &json!({"path": "../escape.md", "text": "x"})).is_err());
        assert!(s.call("write_document", &json!({"path": "/etc/mdcraft-test.md", "text": "x"})).is_err());
        assert!(s.call("read_document", &json!({"path": "/etc/hostname"})).is_err());
        assert!(s.call("write_document", &json!({"path": "sub/new.md", "text": "x"})).is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn protocol() {
        let s = Server { o: Options::default(), live: None };
        let init =
            s.handle(&json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26"}})).unwrap_or_default();
        assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
        assert!(s.handle(&json!({"jsonrpc": "2.0", "method": "notifications/initialized"})).is_none());
        let list = s.handle(&json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})).unwrap_or_default();
        let names: Vec<&str> = list["result"]["tools"].as_array().map(|a| a.iter().filter_map(|t| t["name"].as_str()).collect()).unwrap_or_default();
        assert!(names.contains(&"create_document") && !names.contains(&"app_state"));
        let bad = s
            .handle(&json!({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "app_state", "arguments": {}}}))
            .unwrap_or_default();
        assert_eq!(bad["result"]["isError"], true);
    }
}
