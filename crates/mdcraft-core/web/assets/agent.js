/* mdcraft — the agent bridge in the page. When mdcraft runs with --control, AI agents
 * (mdcraft-cli mcp --connect) send requests through the server; this loop picks them up,
 * runs them on the open document — mostly as commands by id, the same verbs the ribbon
 * and the keyboard use — and posts the answers back. Never throws away unsaved work:
 * opening or creating a document while the current one has changes is refused. */
(function () {
  'use strict';
  const MD = window.MD;
  const E = MD.editor;

  function need(cond, msg) { if (!cond) throw new Error(msg); }
  function needDoc() { need(MD.doc.open, 'no document is open (use new_document or open_document first)'); }
  function needClean() {
    need(!(MD.doc.open && MD.doc.dirty), '“' + MD.doc.name + '” has unsaved changes: save it first (app_save) so nothing is lost');
  }
  /** Replaces the whole text as one undoable edit (Ctrl+Z in the window brings the old text back). */
  function replaceAll(text) {
    E.selectAll();
    E.insert(text, { noFocus: true });
  }
  function settle(ms) { return new Promise((r) => setTimeout(r, ms || 0)); }

  function state() {
    const d = MD.doc;
    const s = d.open ? MD.stats() : null;
    return {
      open: d.open, path: d.path || null, name: d.name || null, saved: !!d.saved, dirty: !!d.dirty,
      view: MD.view && MD.view(), tab: MD.currentTab && MD.currentTab(),
      backstage: !!(MD.backstageOpen && MD.backstageOpen()),
      cursor: d.open ? E.cursorPos() : null,
      selection: d.open ? E.selectedText() : '',
      isDeck: d.open ? MD.isDeck() : false,
      theme: d.open ? MD.currentTheme() : null,
      frontMatter: d.open ? E.frontMatter() : {},
      stats: s,
    };
  }

  function commandInfo(c) {
    let enabled = true, checked;
    try { enabled = c.enabled ? !!c.enabled() : true; } catch (e) { enabled = false; }
    try { checked = c.checked ? !!c.checked() : undefined; } catch (e) { checked = undefined; }
    return { id: c.id, label: c.label, key: c.key || null, keywords: c.keywords || '', enabled, checked, editing: !!c.editing };
  }

  const ops = {
    state,

    get_text(a) {
      needDoc();
      const text = E.get();
      if (a && (a.fromLine || a.toLine)) {
        const lines = text.split('\n');
        const from = Math.max(1, a.fromLine || 1), to = Math.min(lines.length, a.toLine || lines.length);
        return { text: lines.slice(from - 1, to).join('\n'), fromLine: from, toLine: to, totalLines: lines.length };
      }
      return { text, totalLines: text.split('\n').length };
    },

    async set_text(a) {
      need(a && typeof a.text === 'string', 'text required');
      if (!MD.doc.open) await MD.newFromTemplate('blank');
      replaceAll(a.text);
      await settle(50);
      return state();
    },

    insert(a) {
      needDoc();
      need(a && typeof a.text === 'string', 'text required');
      if (a.atEnd) { const t = E.get(); E.goToLine(t.split('\n').length - 1); }
      if (a.block) E.insertBlock(a.text); else E.insert(a.text, { noFocus: true });
      return state();
    },

    replace(a) {
      needDoc();
      need(a && typeof a.find === 'string' && a.find !== '', 'find required');
      const text = E.get();
      const rep = typeof a.replace === 'string' ? a.replace : '';
      let count = 0, out;
      if (a.all) {
        out = text.split(a.find).join(rep);
        count = text.split(a.find).length - 1;
      } else {
        const i = text.indexOf(a.find);
        if (i >= 0) { out = text.slice(0, i) + rep + text.slice(i + a.find.length); count = 1; }
      }
      need(count > 0, 'text not found: ' + a.find);
      replaceAll(out);
      return { replaced: count };
    },

    select(a) {
      needDoc();
      a = a || {};
      if (typeof a.find === 'string') { need(E.find(a.find), 'text not found: ' + a.find); }
      else if (a.line) E.goToLine(a.line - 1, !!a.selectLine);
      else if (a.all) E.selectAll();
      else throw new Error('give find, line or all');
      return { cursor: E.cursorPos(), selection: E.selectedText() };
    },

    list_commands(a) {
      const q = ((a && a.search) || '').toLowerCase();
      const out = [];
      for (const c of MD.commands.values()) {
        if (q && !(c.id + ' ' + c.label + ' ' + (c.keywords || '')).toLowerCase().includes(q)) continue;
        out.push(commandInfo(c));
      }
      return { commands: out };
    },

    async run_command(a) {
      need(a && a.id, 'id required');
      const c = MD.command(a.id);
      need(c, 'unknown command ' + a.id + ' (list_commands shows them)');
      if (/^file\.(close|new|open|recover)$|^file\.new(Blank|Deck)$/.test(a.id)) needClean();
      need(!c.enabled || c.enabled(), a.id + ' is not available right now');
      if (c.editing) needDoc();
      await MD.run(a.id, a.args);
      await settle(50);
      return { ran: a.id, state: state() };
    },

    async new_document(a) {
      needClean();
      await MD.newFromTemplate((a && a.template) || 'blank');
      await settle(50);
      return state();
    },

    async open_document(a) {
      need(a && a.path, 'path required');
      needClean();
      await MD.api('/api/file?path=' + encodeURIComponent(a.path)); // fails with the reason, without a dialog
      await MD.openPath(a.path);
      await settle(50);
      need(MD.doc.open, 'could not open ' + a.path);
      return state();
    },

    async save(a) {
      needDoc();
      const path = a && a.path;
      if (path) {
        need(await MD.saveTo(/\.[\w]+$/.test(MD.basename(path)) ? path : path + '.md', true), 'could not save to ' + path);
      } else {
        need(MD.doc.saved, 'this document has never been saved: give a path');
        need(await MD.saveTo(MD.doc.path, true), 'could not save ' + MD.doc.path);
      }
      return state();
    },

    set_view(a) {
      need(a && ['write', 'split', 'read'].includes(a.view), 'view must be write, split or read');
      MD.setView(a.view);
      return state();
    },
  };

  let stopped = false, running = false;
  async function loop() {
    if (running) return;
    running = true;
    let failures = 0;
    while (!stopped) {
      let req;
      try { req = await MD.api('/api/agent/next'); failures = 0; } catch (e) {
        failures++;
        if (/403/.test(String(e.message)) || /control is off/.test(String(e.message))) return;
        await settle(Math.min(10000, 500 * failures));
        continue;
      }
      if (!req || !req.id) continue;
      let answer;
      try {
        const fn = ops[req.op];
        if (!fn) throw new Error('unknown operation ' + req.op);
        answer = { id: req.id, ok: true, value: await fn(req.args || {}) };
      } catch (e) {
        answer = { id: req.id, ok: false, error: (e && e.message) || String(e) };
      }
      try { await MD.api('/api/agent/result', answer); } catch (e) { /* the agent gave up */ }
    }
  }

  // app.js calls start() at the end of boot (the editor exists and /api/app has answered).
  MD.agent = { ops, start() { if (MD.app && MD.app.agent) loop(); }, stop() { stopped = true; } };
  if (MD.booted) MD.agent.start();
})();
