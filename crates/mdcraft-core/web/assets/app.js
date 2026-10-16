/* mdcraft — the application: the open document, files, views, panes, status bar,
 * preferences, export and the native shell's events. Loaded last. */
(function () {
  'use strict';
  const MD = window.MD;
  const ML = window.ML;
  const E = MD.editor;
  const { h } = MD;
  const $ = (id) => document.getElementById(id);
  const content = $('ml-content');

  // ================================================================== preferences
  const DEFAULTS = { darkPage: false, wrap: true, lineNumbers: false, spellcheck: true, sync: true, appearance: 'system', editorFont: 'mono', editorFontSize: 15,
    view: 'split', nav: false, navTab: 'outline', ribbonCollapsed: false, autosave: false, closeBrackets: false, startup: 'start', zoom: 1, split: 50 };
  MD.pref = (k) => { const ui = (MD.app && MD.app.prefs && MD.app.prefs.ui) || {}; return k in ui ? ui[k] : DEFAULTS[k]; };
  let prefTimer = null, prefPatch = {};
  MD.setPref = (k, v) => {
    MD.app.prefs.ui[k] = v;
    prefPatch[k] = v;
    clearTimeout(prefTimer);
    prefTimer = setTimeout(() => { const p = prefPatch; prefPatch = {}; MD.api('/api/prefs', { ui: p }).catch((e) => MD.toast(e.message)); }, 300);
    applyPref(k);
    MD.refreshRibbon();
  };
  MD.setRenderPref = async (k, v) => {
    try { MD.app.prefs = await MD.api('/api/prefs', { render: { [k]: v } }); } catch (e) { MD.toast(e.message); }
    if (k === 'math') { try { localStorage.removeItem('ml.math'); } catch (e) { /* ignore */ } ML.rerender(); }
  };
  function applyPref(k) {
    const v = MD.pref(k);
    switch (k) {
      case 'wrap': case 'lineNumbers': case 'spellcheck': case 'closeBrackets': E.setOption(k, !!v); break;
      case 'sync': ML.setSync(!!v); break;
      case 'appearance': {
        const dark = v === 'dark' || ((!v || v === 'system') && matchMedia('(prefers-color-scheme: dark)').matches);
        document.documentElement.dataset.ui = dark ? 'dark' : 'light';
        if (MD.isNative()) MD.native('theme', { dark });
        break;
      }
      case 'darkPage': ML.setThemePref(v ? 'dark' : 'light'); break;
      case 'editorFont': case 'editorFontSize': {
        const fam = { mono: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace', sans: '"Source Sans 3", "Segoe UI", sans-serif', serif: '"Source Serif 4", Georgia, serif' }[MD.pref('editorFont')] || 'monospace';
        $('md-editor').style.setProperty('--ed-font', fam);
        $('md-editor').style.setProperty('--ed-size', MD.pref('editorFontSize') + 'px');
        break;
      }
      case 'ribbonCollapsed': document.body.classList.toggle('md-ribbon-collapsed', !!v); $('md-collapse').innerHTML = MDIcons.icon(v ? 'chevron-down' : 'chevron-up', 18); break;
      case 'split': $('md-main').style.setProperty('--split', v + '%'); break;
      default: break;
    }
  }

  // ================================================================== the document
  const doc = MD.doc = { open: false, path: '', name: '', saved: false, dirty: false, key: '', lastSaved: null };
  let untitledN = { document: 0, presentation: 0 };

  function newKey() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function setDoc(fields, text) {
    Object.assign(doc, { open: true, dirty: false, lastSaved: null }, fields);
    if (!doc.key) doc.key = newKey();
    E.set(text);
    pushNow();
    updateTitle();
    updateStatus();
    if (MD.backstageOpen()) MD.closeBackstage();
    document.body.classList.toggle('md-no-document', false);
    MD.refreshRibbon();
    setTimeout(() => E.focus(), 30);
  }

  /** Asks to save a changed document. Resolves true when it's fine to go on. */
  MD.confirmDiscard = async () => {
    if (!doc.open || !doc.dirty) return true;
    const v = await MD.dialog({
      title: 'mdcraft',
      body: h('div', h('p.md-dlg-text', h('b', 'Do you want to save the changes to “' + doc.name + '”?')), h('p.md-hint', 'Your changes will be lost if you don’t save them.')),
      buttons: [{ label: 'Don’t Save', value: 'discard', left: true }, { label: 'Cancel', value: null }, { label: 'Save', value: 'save', primary: true }],
    });
    if (v === 'save') return await MD.save();
    if (v === 'discard') { discardAutosave(); return true; }
    return false;
  };

  MD.newFromTemplate = async (id) => {
    if (!(await MD.confirmDiscard())) return;
    let t;
    try { t = await MD.api('/api/template?id=' + encodeURIComponent(id)); } catch (e) { MD.toast(e.message); return; }
    const kind = t.kind === 'presentation' ? 'presentation' : 'document';
    const base = kind === 'presentation' ? 'Presentation' : 'Document';
    const n = ++untitledN[kind];
    const name = base + ' ' + n + '.md';
    setDoc({ path: MD.join(MD.app.documents, name), name, saved: false, key: newKey(), template: id }, t.text);
    if (kind === 'presentation' && MD.currentTab() === 'home') MD.selectTab('slides');
  };

  MD.openPath = async (path) => {
    if (doc.open && doc.saved && doc.path === path) { MD.closeBackstage(); return; }
    if (!(await MD.confirmDiscard())) return;
    let f;
    try { f = await MD.api('/api/file?path=' + encodeURIComponent(path)); } catch (e) { MD.alert('Cannot open', e.message); return; }
    setDoc({ path: f.path, name: f.name, saved: true, key: newKey() }, f.text);
    doc.savedText = f.text;
    MD.app.recent = null;
  };
  MD.openRecovered = async (v) => {
    if (!(await MD.confirmDiscard())) return;
    const name = v.name || 'Recovered.md';
    setDoc({ path: v.path || MD.join(MD.app.documents, name), name, saved: false, key: newKey() }, v.text || '');
    doc.dirty = true; updateTitle(); updateStatus();
    MD.toast('Recovered “' + name + '”. Save it to keep it.', 5000);
  };

  MD.openDialog = async (forceNative) => {
    if (MD.isNative()) {
      try {
        const p = await MD.native('open-dialog', { title: 'Open', filters: [['Markdown', ['md', 'markdown', 'mdown', 'mkd', 'txt']], ['All files', ['*']]], dir: doc.saved ? MD.dirname(doc.path) : MD.app.documents });
        if (p) MD.openPath(p);
        return;
      } catch (e) { if (forceNative) { MD.toast(e.message); return; } }
    }
    MD.openBackstage('open');
  };

  MD.suggestName = () => {
    if (doc.saved) return doc.name;
    const fm = E.frontMatter();
    let t = fm.title || (/^#\s+(.+)$/m.exec(E.get().replace(/^---[\s\S]*?\n---\n/, '')) || [])[1] || doc.name.replace(/\.md$/, '');
    t = t.replace(/[\\/:*?"<>|#]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Document';
    return t + '.md';
  };

  MD.save = async () => {
    if (!doc.open) return false;
    if (!doc.saved) return await MD.saveAs();
    return await MD.saveTo(doc.path, true);
  };
  MD.saveAs = async () => {
    if (!doc.open) return false;
    if (MD.isNative()) {
      try {
        const p = await MD.native('save-dialog', { name: MD.suggestName(), dir: doc.saved ? MD.dirname(doc.path) : MD.app.documents, filters: [['Markdown', ['md']]] });
        if (!p) return false;
        return await MD.saveTo(/\.[\w]+$/.test(MD.basename(p)) ? p : p + '.md');
      } catch (e) { /* fall back to the in-app page */ }
    }
    MD.openBackstage('saveas');
    return false;
  };
  MD.saveTo = async (path, quiet) => {
    const text = E.get();
    try {
      const r = await MD.api('/api/file/save', { path, text });
      const moved = r.path !== doc.path;
      Object.assign(doc, { path: r.path, name: r.name, saved: true, dirty: E.get() !== text, lastSaved: Date.now(), savedText: text });
      if (moved) pushNow();
      discardAutosave();
      updateTitle(); updateStatus();
      if (!quiet) MD.toast('Saved ' + r.name);
      return true;
    } catch (e) { MD.alert('Cannot save', e.message); return false; }
  };
  MD.saveCopy = async () => {
    const name = MD.suggestName().replace(/\.md$/, '') + ' (copy).md';
    const done = async (p) => { try { await MD.api('/api/file/save', { path: p, text: E.get() }); MD.toast('Saved a copy: ' + MD.basename(p)); return true; } catch (e) { MD.toast(e.message); return false; } };
    if (MD.isNative()) { const p = await MD.native('save-dialog', { name, dir: doc.saved ? MD.dirname(doc.path) : MD.app.documents }).catch(() => null); if (p) done(p); return; }
    const fb = MD.folderBrowser({ mode: 'save', name, dir: doc.saved ? MD.dirname(doc.path) : MD.app.documents, onPick: async (p) => { if (await done(p)) dlg.close(); } });
    const dlg = { close: () => {} };
    MD.dialog({ title: 'Save a copy', width: 760, body: fb, buttons: null, onOpen: (d, close) => { dlg.close = close; } });
  };
  MD.closeDocument = async () => {
    if (!(await MD.confirmDiscard())) return;
    doc.open = false; doc.dirty = false; doc.path = ''; doc.name = ''; doc.saved = false;
    E.set('');
    content.innerHTML = '';
    document.body.classList.add('md-no-document');
    updateTitle(); updateStatus();
    MD.openBackstage('home');
  };
  MD.newWindow = () => { if (MD.isNative()) MD.native('new-window', {}); else MD.toast('New windows are available in the desktop app'); };

  // ------------------------------------------------------------------ syncing the text with the renderer
  let pushTimer = null;
  function pushNow() {
    clearTimeout(pushTimer);
    if (!doc.open) return;
    MD.api('/api/doc', { path: doc.path, text: E.get() }).catch((e) => console.warn(e));
  }
  let autosaveTimer = null, recoveryTimer = null;
  MD.onEditorChange = () => {
    if (!doc.open) {
      // typing on the empty start canvas makes a new document
      Object.assign(doc, { open: true, path: MD.join(MD.app.documents, 'Document ' + (++untitledN.document) + '.md'), name: 'Document ' + untitledN.document + '.md', saved: false, key: newKey() });
      document.body.classList.remove('md-no-document');
    }
    doc.dirty = doc.savedText === undefined || E.get() !== doc.savedText || !doc.saved;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 70);
    updateTitle();
    scheduleStatus();
    clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(writeAutosave, 4000);
    if (MD.pref('autosave') && doc.saved) { clearTimeout(autosaveTimer); autosaveTimer = setTimeout(() => { if (doc.dirty && doc.saved) MD.saveTo(doc.path, true); }, 2500); }
  };
  function writeAutosave() {
    if (!doc.open || !doc.dirty) return;
    MD.api('/api/autosave', { key: doc.key, path: doc.path, name: doc.name, text: E.get() }).catch(() => {});
  }
  function discardAutosave() { if (doc.key) MD.api('/api/autosave', { key: doc.key, text: null }).catch(() => {}); clearTimeout(recoveryTimer); }

  let cursorTimer = null;
  MD.onEditorCursor = () => {
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => {
      const p = E.cursorPos();
      $('md-st-pos').textContent = 'Ln ' + p.line + ', Col ' + p.col + (p.sel ? ' (' + p.sel + ' selected)' : '');
      if (MD.pref('sync') && MD.view() === 'split') ML.cursor(p.line - 1);
      MD.refreshRibbon();
      markNavCurrent();
      if (MD.isDeck()) $('md-st-slides').textContent = 'Slide ' + E.currentSlide() + ' of ' + E.slideCount();
    }, 40);
  };

  // pictures dropped or pasted into the editor
  MD.onEditorPaste = () => false;
  MD.onEditorDrop = (e) => {
    if (MD.isNative()) { e.preventDefault(); return true; } // the shell delivers dropped paths
    return false;
  };

  // ================================================================== title and status bar
  function updateTitle() {
    const name = doc.open ? doc.name : 'mdcraft';
    const t = doc.open ? (doc.dirty ? '• ' : '') + name + ' — mdcraft' : 'mdcraft';
    document.title = t;
    const dn = $('md-docname');
    dn.textContent = doc.open ? name.replace(/\.md$/, '') + (doc.saved ? (doc.dirty ? ' • Edited' : ' • Saved') : ' • Not saved') : '';
    dn.title = doc.saved ? doc.path : 'Not saved yet';
    if (MD.isNative()) MD.native('set-title', { title: t });
    $('md-st-save').textContent = !doc.open ? '' : !doc.saved ? 'Not saved yet' : doc.dirty ? 'Edited' : 'Saved';
  }
  MD.docTitle = () => (E.frontMatter().title || doc.name.replace(/\.md$/, ''));
  ML.docTitle = MD.docTitle;
  ML.isNative = MD.isNative;

  MD.stats = () => {
    const raw = E.get();
    const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n(---|\.\.\.)\r?\n?/, '').replace(/<!--[\s\S]*?-->/g, '');
    const prose = body.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`~=|\-[\]()!]+/g, ' ');
    const words = (prose.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
    const slides = E.slideCount();
    return {
      words, chars: body.length, charsNoSpace: body.replace(/\s/g, '').length,
      paragraphs: body.split(/\n\s*\n/).filter((p) => p.trim()).length, headings: (body.match(/^#{1,6}\s/gm) || []).length,
      lines: raw.split('\n').length, slides, readMin: Math.max(1, Math.round(words / 230)), speakMin: Math.max(1, Math.round(words / 130)),
    };
  };
  let statusTimer = null;
  function scheduleStatus() { clearTimeout(statusTimer); statusTimer = setTimeout(updateStatus, 250); }
  function updateStatus() {
    if (!doc.open) { $('md-st-words').textContent = ''; $('md-st-pos').textContent = ''; $('md-st-slides').hidden = true; return; }
    const s = MD.stats();
    $('md-st-words').textContent = s.words.toLocaleString() + ' word' + (s.words === 1 ? '' : 's');
    $('md-st-slides').hidden = !s.slides;
    if (s.slides) $('md-st-slides').textContent = 'Slide ' + E.currentSlide() + ' of ' + s.slides;
    updateTitle();
  }

  // ================================================================== views and panes
  const main = $('md-main');
  MD.view = () => main.dataset.view;
  MD.setView = (v) => {
    main.dataset.view = v;
    if (MD.pref('view') !== v) MD.setPref('view', v);
    if (v !== 'read') setTimeout(() => E.view.requestMeasure(), 0);
    MD.refreshRibbon();
  };
  MD.navOpen = () => !$('md-nav').hidden;
  MD.setNav = (open, tab) => {
    $('md-nav').hidden = !open;
    if (tab) setNavTab(tab);
    if (MD.pref('nav') !== open) MD.setPref('nav', open);
    if (open) buildNav();
    MD.refreshRibbon();
  };
  function setNavTab(t) {
    navTab = t;
    $('md-nav-tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.nav === t));
    if (MD.pref('navTab') !== t) MD.setPref('navTab', t);
    buildNav();
  }
  let navTab = 'outline';
  $('md-nav-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-nav]'); if (b) setNavTab(b.dataset.nav); });
  $('md-nav-filter').addEventListener('input', () => buildNav());
  $('md-nav-filter').addEventListener('keydown', (e) => { if (e.key === 'Enter') { if (!E.find($('md-nav-filter').value)) MD.toast('Not found'); } });

  function buildNav() {
    if (!MD.navOpen()) return;
    const body = $('md-nav-body');
    const q = $('md-nav-filter').value.trim().toLowerCase();
    if (navTab === 'slides') {
      const slides = [...content.querySelectorAll('.ml-slide-wrap .ml-slide')];
      if (!slides.length) { body.replaceChildren(h('p.md-empty', 'This document has no slides. Slides › New slide adds one, or Slides › Convert to slides splits it at the headings.')); return; }
      const themeCls = [...content.classList].filter((c) => c.startsWith('theme-'));
      body.replaceChildren(...slides.map((s, i) => {
        const clone = s.cloneNode(true);
        clone.querySelectorAll('canvas, video, iframe, .ml-molstar').forEach((c) => c.replaceWith(h('div.md-thumb-ph')));
        const art = h('article.markdown-body.ml-deck.md-nav-slide-body', clone);
        themeCls.forEach((c) => art.classList.add(c));
        const item = h('button.md-nav-slide', { dataset: { n: i + 1 }, title: 'Slide ' + (i + 1) }, h('span.md-nav-slide-n', String(i + 1)), h('div.md-nav-slide-frame', art));
        return item;
      }));
    } else {
      const hs = (ML.state.headings || []).filter((x) => !q || x.text.toLowerCase().includes(q));
      if (!hs.length) { body.replaceChildren(h('p.md-empty', q ? 'No headings match.' : 'Headings (# Title, ## Section…) show up here.')); return; }
      body.replaceChildren(...hs.map((x) => h('button.md-nav-h.l' + x.level, { dataset: { line: x.line, id: x.id }, title: x.text }, x.text)));
    }
    markNavCurrent();
  }
  $('md-nav-body').addEventListener('click', (e) => {
    const s = e.target.closest('.md-nav-slide');
    if (s) { E.goToSlide(+s.dataset.n); scrollPreviewToSlide(+s.dataset.n); return; }
    const hh = e.target.closest('.md-nav-h');
    if (hh) { E.goToLine(+hh.dataset.line - 1); const el = document.getElementById(hh.dataset.id); if (el && MD.view() !== 'write') el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
  function scrollPreviewToSlide(n) { const w = content.querySelector('.ml-slide-wrap[data-slide-n="' + n + '"]'); if (w && MD.view() !== 'write') w.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  function markNavCurrent() {
    if (!MD.navOpen()) return;
    const body = $('md-nav-body');
    if (navTab === 'slides') {
      const cur = E.currentSlide();
      body.querySelectorAll('.md-nav-slide').forEach((b) => b.classList.toggle('on', +b.dataset.n === cur));
      const on = body.querySelector('.md-nav-slide.on'); if (on) on.scrollIntoView({ block: 'nearest' });
    } else {
      const line = E.cursorLine() + 1;
      let cur = null;
      body.querySelectorAll('.md-nav-h').forEach((b) => { if (+b.dataset.line <= line) cur = b; });
      body.querySelectorAll('.md-nav-h').forEach((b) => b.classList.toggle('on', b === cur));
    }
  }

  // splitter
  (function () {
    const split = $('md-split');
    let drag = false;
    split.addEventListener('mousedown', (e) => { drag = true; e.preventDefault(); document.body.classList.add('md-dragging'); });
    addEventListener('mousemove', (e) => {
      if (!drag) return;
      const r = main.getBoundingClientRect();
      const navW = MD.navOpen() ? $('md-nav').getBoundingClientRect().width : 0;
      const pct = Math.max(20, Math.min(80, ((e.clientX - r.left - navW) / (r.width - navW)) * 100));
      main.style.setProperty('--split', pct.toFixed(1) + '%');
    });
    addEventListener('mouseup', () => { if (!drag) return; drag = false; document.body.classList.remove('md-dragging'); MD.setPref('split', parseFloat(main.style.getPropertyValue('--split')) || 50); });
    split.addEventListener('dblclick', () => { MD.setPref('split', 50); });
  })();

  // preview → editor: double-click a block to edit it
  content.addEventListener('dblclick', (e) => {
    if (window.getSelection && String(window.getSelection()).trim() && !e.target.closest('.ml-slide')) { /* a word selection */ }
    const el = e.target.closest('[data-sourcepos]');
    if (!el) return;
    const m = /^(\d+):/.exec(el.getAttribute('data-sourcepos'));
    if (!m) return;
    if (MD.view() === 'read') MD.setView('split');
    E.goToLine(+m[1] - 1);
  });
  ML.previewKeys = () => false;

  MD.toggleFocus = () => { document.body.classList.toggle('md-focus'); if (document.body.classList.contains('md-focus')) { MD.setView('write'); MD.toast('Focus mode — Esc to leave'); } else MD.setView(MD.pref('view') === 'write' ? 'split' : MD.pref('view')); MD.refreshRibbon(); };
  MD.zoomToWidth = () => {
    const pane = $('ml-scroller').getBoundingClientRect().width;
    const page = MD.isDeck() ? 980 : (pageWidthPx() + 80);
    ML.setZoom(Math.max(0.5, Math.min(2.5, (pane - 40) / page)));
  };
  function pageWidthPx() { const fm = E.frontMatter(); const w = { a4: 794, letter: 816, a5: 559, legal: 816 }[fm.paper || 'a4'] || 794; return fm.orientation === 'landscape' ? Math.round(w * 1.414) : w; }

  // zoom: status slider ↔ preview
  ML.onZoom = (z) => { $('md-zoom-slider').value = Math.round(z * 100); $('md-zoom-label').textContent = Math.round(z * 100) + '%'; if (Math.abs((MD.pref('zoom') || 1) - z) > 0.001) MD.setPref('zoom', z); };
  $('md-zoom-slider').addEventListener('input', (e) => ML.setZoom(+e.target.value / 100));
  $('ml-scroller').addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); ML.setZoom(ML.state.zoom + (e.deltaY < 0 ? 0.1 : -0.1)); } }, { passive: false });

  // ================================================================== the rendered document: themes, page setup
  MD.isDeck = () => (ML.lastState && ML.lastState.slides > 0) || (doc.open && E.slideMarkers().length > 0);
  MD.currentTheme = () => E.frontMatter().theme || (MD.isDeck() ? 'paper' : 'office');
  MD.currentSlideClass = () => {
    const st = E.slideStarts()[E.currentSlide() - 1];
    if (!st || !st.marker) return '';
    return (/class\s*=\s*"([^"]*)"/.exec(E.view.state.doc.line(st.line).text) || [])[1] || '';
  };
  const pageStyle = h('style', { id: 'md-page-style' });
  document.head.append(pageStyle);
  function applyDocumentLook(s) {
    const meta = s.meta || {};
    const deck = s.slides > 0;
    const known = MD.themes.map((t) => t.id);
    let theme = (meta.theme || '').toLowerCase();
    if (!known.includes(theme)) theme = deck ? 'paper' : 'office';
    const keep = [...content.classList].filter((c) => !/^(theme-|paper-|margins-|ml-deck$|md-numbered$|md-justify$|md-landscape$)/.test(c));
    const paper = (meta.paper || 'a4').toLowerCase();
    const cls = [...keep, 'theme-' + theme, 'paper-' + paper, 'margins-' + (meta.margins || 'normal').toLowerCase()];
    if (deck) cls.push('ml-deck');
    if (/^(true|yes|on)$/i.test(meta.numbered || '')) cls.push('md-numbered');
    if (/^(true|yes|on)$/i.test(meta.justify || '')) cls.push('md-justify');
    const landscape = (meta.orientation || (deck ? 'landscape' : 'portrait')).toLowerCase() === 'landscape';
    if (landscape) cls.push('md-landscape');
    content.className = cls.join(' ');
    $('md-page').className = 'md-page-' + (deck ? 'deck' : 'doc') + ' paper-' + paper + (landscape ? ' md-landscape' : '');
    const wm = $('md-watermark');
    wm.hidden = !meta.watermark || deck;
    wm.textContent = meta.watermark || '';
    const size = { a4: 'A4', letter: 'letter', a5: 'A5', legal: 'legal' }[paper] || 'A4';
    const margin = { normal: '20mm 22mm', narrow: '12.7mm', wide: '30mm 35mm' }[(meta.margins || 'normal').toLowerCase()] || '20mm 22mm';
    pageStyle.textContent = '@page { size: ' + size + ' ' + (landscape ? 'landscape' : 'portrait') + '; margin: ' + (deck ? '10mm' : margin) + '; }';
    $('md-st-slides').hidden = !deck;
  }
  const prevUpdate = ML.onUpdate;
  ML.onUpdate = (s) => {
    prevUpdate && prevUpdate(s);
    ML.lastState = s;
    if (!doc.open) return;
    applyDocumentLook(s);
    updateStatus();
    if (MD.navOpen()) { buildNav(); (ML.renderPromise || Promise.resolve()).then(() => { if (navTab === 'slides') buildNav(); }); }
    MD.refreshRibbon();
  };
  ML.onOpenLink = async (path) => {
    if (path === doc.path) return;
    MD.openPath(path);
  };
  MD.openExternal = (url) => { if (MD.isNative()) MD.native('open-external', { url }); else window.open(url, '_blank', 'noopener'); };
  ML.openExternal = MD.openExternal;

  // ================================================================== files from outside (pictures, links)
  /** Picks a file: the native dialog, or the in-app browser. */
  MD.pickFile = async (opts) => {
    if (MD.isNative()) {
      try {
        const filters = opts.extensions ? [[opts.title.replace(/^Insert (a |an )?/i, ''), opts.extensions], ['All files', ['*']]] : [['All files', ['*']]];
        return await MD.native('open-dialog', { title: opts.title, filters, dir: doc.saved ? MD.dirname(doc.path) : MD.app.documents });
      } catch (e) { /* fall through */ }
    }
    return await new Promise((resolve) => {
      let done = false;
      const fb = MD.folderBrowser({ mode: 'open', filter: opts.filter || 'all', dir: doc.saved ? MD.dirname(doc.path) : null, onPick: (p) => { done = true; resolve(p); close(); } });
      let close = () => {};
      MD.dialog({ title: opts.title || 'Choose a file', width: 780, body: fb, buttons: null, onOpen: (d, c) => { close = c; } }).then(() => { if (!done) resolve(null); });
    });
  };
  /** The path to write in the document for a file (relative when possible). */
  MD.relativeAsset = async (p, copy) => {
    try {
      const v = await MD.api('/api/picture', { doc: doc.path, src: p, copy: !!copy });
      if (v.copied) MD.toast('Copied the picture into the document’s images folder');
      return v.path;
    } catch (e) { return p; }
  };

  // ================================================================== export
  async function fetchText(u) { const r = await fetch(u); return r.ok ? r.text() : ''; }
  async function fontDataUrl(u) {
    try { const r = await fetch(u); const b = await r.blob(); return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }); } catch (e) { return u; }
  }
  /** CSS with url(...) font references replaced by data: URLs (self-contained). */
  async function inlineFonts(css, base, only) {
    const urls = [...new Set([...css.matchAll(/url\(["']?([^"')]+\.woff2)["']?\)/g)].map((m) => m[1]))];
    for (const u of urls) {
      if (only && !only.some((f) => u.includes(f))) continue;
      const abs = u.startsWith('/') ? u : base + u;
      css = css.split(u).join(await fontDataUrl(abs));
    }
    return css;
  }
  /** A standalone HTML page of the rendered document (diagrams as SVG, charts as pictures). */
  MD.buildHtmlPage = async () => {
    const clone = await ML.withTheme('light', async () => { await ML.settled(60000); return ML.cloneRendered(); });
    clone.querySelectorAll('[data-sourcepos]').forEach((e) => e.removeAttribute('data-sourcepos'));
    clone.querySelectorAll('[data-done]').forEach((e) => e.removeAttribute('data-done'));
    const theme = MD.currentTheme();
    const fontsNeeded = { office: ['SourceSans3'], report: ['SourceSerif4', 'SourceSans3'], classic: ['SourceSerif4'], modern: ['Inter'], letter: ['SourceSerif4'], newsletter: ['SourceSans3', 'SourceSerif4'], github: [] }[theme] || ['Inter', 'SourceSans3', 'SourceSerif4'];
    let css = await fetchText('/assets/fonts.css');
    css = css.split('@font-face').filter((b, i) => i === 0 || fontsNeeded.some((f) => b.includes(f)) || b.includes('JetBrains') && clone.querySelector('pre, code')).join('@font-face');
    css = await inlineFonts(css, '/fonts/');
    css += '\n' + await fetchText('/assets/markdown.css') + '\n' + await fetchText('/assets/themes.css') + '\n' + await fetchText('/vendor/hljs/styles/github.min.css');
    if (clone.querySelector('.katex')) css += '\n' + await inlineFonts(await fetchText('/vendor/katex/katex.min.css'), '/vendor/katex/');
    css += '\n' + pageStyle.textContent + '\nbody{margin:0;background:#fff}.markdown-body{margin:0 auto}\n@media screen{.markdown-body:not(.ml-deck){max-width:860px;padding:48px 40px 80px}}';
    const title = MD.docTitle();
    const wm = !$('md-watermark').hidden ? '<div id="md-watermark">' + MD.esc($('md-watermark').textContent) + '</div>' : '';
    return '<!doctype html>\n<html lang="en" data-theme="light">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="generator" content="mdcraft ' + MD.app.version + '">\n<title>' + MD.esc(title) + '</title>\n<style>\n' + css + '\n</style>\n</head>\n<body>\n' + wm + '<article class="' + content.className + '">\n' + clone.innerHTML + '\n</article>\n</body>\n</html>\n';
  };
  async function saveText(name, text, ext) {
    if (MD.isNative()) {
      const p = await MD.native('save-dialog', { name, dir: doc.saved ? MD.dirname(doc.path) : MD.app.documents, filters: [[ext.toUpperCase(), [ext]]] }).catch(() => null);
      if (!p) return;
      try { await MD.api('/api/file/save', { path: p, text, recent: false }); MD.toast('Exported ' + MD.basename(p)); } catch (e) { MD.alert('Export failed', e.message); }
      return;
    }
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: ext === 'html' ? 'text/html' : 'text/plain' })), download: name });
    document.body.append(a); a.click(); a.remove();
  }
  MD.exportHtml = async () => {
    if (!doc.open) return;
    MD.toast('Preparing the web page…', 20000);
    try { const html = await MD.buildHtmlPage(); await saveText(MD.suggestName().replace(/\.md$/, '') + '.html', html, 'html'); }
    catch (e) { MD.alert('Export failed', e.message || String(e)); }
  };
  MD.exportPdf = async () => {
    if (MD.backstageOpen()) MD.closeBackstage();
    MD.toast('In the print dialog, choose “Save as PDF” or “Print to File”.', 5000);
    setTimeout(() => ML.print(), 400);
  };
  MD.exportText = async () => {
    const txt = content.innerText.replace(/\n{3,}/g, '\n\n');
    await saveText(MD.suggestName().replace(/\.md$/, '') + '.txt', txt, 'txt');
  };
  MD.copyRich = async () => {
    const clone = await ML.withTheme('light', async () => { await ML.settled(30000); return ML.cloneRendered(); });
    const holder = h('div.markdown-body', { contenteditable: 'true', style: { position: 'fixed', left: '-10000px', top: '0', width: '800px', background: '#fff', color: '#000' } });
    holder.className += ' ' + [...content.classList].filter((c) => c.startsWith('theme-')).join(' ');
    holder.innerHTML = clone.innerHTML;
    document.body.append(holder);
    const range = document.createRange(); range.selectNodeContents(holder);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    sel.removeAllRanges(); holder.remove();
    if (!ok) {
      try { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([clone.innerHTML], { type: 'text/html' }), 'text/plain': new Blob([content.innerText], { type: 'text/plain' }) })]); ok = true; } catch (e) { ok = false; }
    }
    MD.toast(ok ? 'Copied — paste it into Word, an email or a web editor' : 'Copying failed');
  };

  // ================================================================== dialogs
  MD.wordCountDialog = () => {
    const s = MD.stats();
    const sel = E.selectedText();
    const rows = [['Words', s.words], ['Characters (no spaces)', s.charsNoSpace], ['Characters (with spaces)', s.chars], ['Paragraphs', s.paragraphs], ['Lines', s.lines], ['Headings', s.headings]];
    if (s.slides) rows.push(['Slides', s.slides], ['Speaking time', '≈ ' + s.speakMin + ' min']);
    rows.push(['Reading time', '≈ ' + s.readMin + ' min']);
    if (sel) rows.unshift(['Selected words', (sel.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length]);
    MD.dialog({ title: 'Word count', width: 360, body: h('table.md-stats', rows.map(([k, v]) => h('tr', h('th', k), h('td', typeof v === 'number' ? v.toLocaleString() : v)))), buttons: [{ label: 'Close', value: true, primary: true }] });
  };
  MD.accessibilityDialog = () => {
    const text = E.get();
    const lines = text.split('\n');
    const issues = [];
    let inFence = false, lastLevel = 0, h1 = 0;
    lines.forEach((l, i) => {
      if (/^\s*(```|~~~)/.test(l)) { inFence = !inFence; return; }
      if (inFence) return;
      const hm = /^(#{1,6})\s+(.*)$/.exec(l);
      if (hm) {
        const lv = hm[1].length;
        if (lv === 1) h1++;
        if (lastLevel && lv > lastLevel + 1 && !/<!-- slide/.test(lines[i - 2] || '')) issues.push({ line: i, kind: 'Heading level skipped', msg: 'A level-' + lv + ' heading follows a level-' + lastLevel + ' heading. Screen readers use headings to navigate.' });
        if (!hm[2].trim()) issues.push({ line: i, kind: 'Empty heading', msg: 'Give the heading some text.' });
        lastLevel = lv;
      }
      for (const m of l.matchAll(/!\[([^\]]*)\]\(([^)]*)\)/g)) if (!m[1].trim()) issues.push({ line: i, kind: 'Missing alternative text', msg: 'Describe the picture between the brackets: ![a description](' + m[2] + ').' });
      for (const m of l.matchAll(/(?<!!)\[([^\]]*)\]\(([^)]*)\)/g)) {
        const t = m[1].trim().toLowerCase();
        if (!t) issues.push({ line: i, kind: 'Empty link text', msg: 'Links need text that says where they go.' });
        else if (['here', 'click here', 'link', 'this', 'more', 'read more'].includes(t)) issues.push({ line: i, kind: 'Unclear link text', msg: '“' + m[1] + '” doesn’t say where the link goes.' });
      }
      if (/<img\b(?![^>]*\balt=)/i.test(l)) issues.push({ line: i, kind: 'Missing alternative text', msg: 'Add alt="…" to the <img> tag.' });
    });
    if (!h1 && !E.frontMatter().title && !MD.isDeck()) issues.unshift({ line: 0, kind: 'No title', msg: 'Start the document with a # Title or set a title in its properties.' });
    const body = issues.length
      ? h('div.md-a11y', issues.map((x) => { const b = h('button.md-a11y-item', h('b', x.kind), h('span', x.msg), h('small', 'Line ' + (x.line + 1))); b.addEventListener('click', () => { document.querySelector('.md-modal-back')?.remove(); E.goToLine(x.line, true); }); return b; }))
      : h('div.md-a11y-ok', MD.icon('check', 28), h('p', 'No issues found. Nice work!'));
    MD.dialog({ title: 'Accessibility', width: 520, body, buttons: [{ label: 'Close', value: true, primary: true }] });
  };
  MD.shortcutsDialog = () => {
    const groups = {};
    for (const c of MD.commands.values()) if (c.key) { const g = c.id.split('.')[0]; (groups[g] = groups[g] || []).push(c); }
    const names = { file: 'File', edit: 'Editing', format: 'Formatting', insert: 'Insert', slides: 'Slides', review: 'Review', view: 'View', help: 'Help', design: 'Design', table: 'Table' };
    const body = h('div.md-shortcuts', Object.entries(groups).map(([g, list]) => h('section', h('h3', names[g] || g), h('table', list.map((c) => h('tr', h('td', c.label.replace(/…$/, '')), h('td', h('kbd', MD.keyLabel(c.key)))))))));
    body.append(h('section', h('h3', 'Slide show'), h('table', [['Next / previous', '→ ←  Space'], ['Speaker notes', 'N'], ['Black screen', 'B'], ['Go to slide', 'number, Enter'], ['End', 'Esc']].map(([a, b]) => h('tr', h('td', a), h('td', h('kbd', b)))))));
    MD.dialog({ title: 'Keyboard shortcuts', width: 760, body, buttons: [{ label: 'Close', value: true, primary: true }] });
  };
  MD.editProperties = () => MD.openBackstage('info');

  // ================================================================== native shell events
  window.__mdNative = {
    /** The window's close button: ask about unsaved changes, then let the shell quit. */
    async requestClose() {
      if (MD.presenting()) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      if (await MD.confirmDiscard()) { discardAutosave(); MD.native('quit', {}); }
    },
    /** Files dropped on the window or passed on the command line. */
    async dropped(paths) {
      const pics = paths.filter((p) => /\.(png|jpe?g|gif|svg|webp|avif|bmp|heic|heif|tiff?|mp4|webm|mkv|mov|avi|m4v|mp3|wav|ogg|m4a|flac)$/i.test(p));
      const mds = paths.filter((p) => /\.(md|markdown|mdown|mkd|txt)$/i.test(p));
      const csvs = paths.filter((p) => /\.(csv|tsv)$/i.test(p));
      if (mds.length && !doc.open) { MD.openPath(mds[0]); return; }
      if (mds.length && !pics.length && !csvs.length) { MD.openPath(mds[0]); return; }
      if (!doc.open) await MD.newFromTemplate('blank');
      for (const p of pics) { const rel = await MD.relativeAsset(p, true); const alt = MD.basename(p).replace(/\.\w+$/, '').replace(/[-_]+/g, ' '); E.insertBlock('![' + alt + '](' + (/[\s()]/.test(rel) ? '<' + rel + '>' : rel) + ')'); }
      for (const p of csvs) E.insertBlock('@import "' + await MD.relativeAsset(p, false) + '"');
      for (const p of mds) if (pics.length || csvs.length) E.insert('[' + MD.basename(p) + '](' + await MD.relativeAsset(p, false) + ')');
    },
    open(path) { MD.openPath(path); },
    template(id) { MD.newFromTemplate(id); },
    menu(cmd) { MD.run(cmd); },
  };
  // a browser tab (mdcraft-cli serve) also guards unsaved work
  addEventListener('beforeunload', (e) => { if (!MD.isNative() && doc.open && doc.dirty) { writeAutosave(); e.preventDefault(); e.returnValue = ''; } });

  // ================================================================== boot
  async function boot() {
    try { MD.app = await MD.api('/api/app'); } catch (e) { document.body.textContent = 'mdcraft could not reach its server: ' + e.message; return; }
    MD.app.sep = MD.app.separator || '/';
    if (!MD.app.prefs.ui) MD.app.prefs.ui = {};
    E.create($('md-editor'), { lineNumbers: !!MD.pref('lineNumbers'), wrap: !!MD.pref('wrap'), spellcheck: !!MD.pref('spellcheck'), closeBrackets: !!MD.pref('closeBrackets') });
    ['editorFont', 'ribbonCollapsed', 'split', 'appearance', 'darkPage', 'sync'].forEach(applyPref);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyPref('appearance'));
    ML.setZoom(+MD.pref('zoom') || 1);
    main.dataset.view = MD.pref('view') || 'split';
    navTab = MD.pref('navTab') || 'outline';
    $('md-nav-tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.nav === navTab));
    if (MD.pref('nav')) $('md-nav').hidden = false;
    MD.renderRibbon();
    MDIcons.fill(document);
    document.body.classList.add('md-no-document');
    document.body.classList.remove('booting');
    updateTitle();
    const st = MD.app.startup || {};
    if (st.open) await MD.openPath(st.open);
    else if (st.template) await MD.newFromTemplate(st.template);
    else if (MD.pref('startup') === 'blank') await MD.newFromTemplate('blank');
    else if (MD.pref('startup') === 'last' && (MD.app.recent || []).find((r) => !r.missing)) await MD.openPath(MD.app.recent.find((r) => !r.missing).path);
    else MD.openBackstage('home');
    if (MD.isNative()) MD.native('ready', {});
    MD.booted = true;
    if (MD.agent) MD.agent.start();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
