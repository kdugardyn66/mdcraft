/* mdcraft — the ribbon (tabs, groups, galleries) and command search. */
(function () {
  'use strict';
  const MD = window.MD;
  const E = MD.editor;
  const { h } = MD;

  // ------------------------------------------------------------------ menus for split buttons
  const menus = {
    diagram: () => MD.diagrams.map((d) => ({ label: d.name, icon: d.icon, cmd: 'insert.diagram', args: { id: d.id } })),
    chart: () => MD.charts.map((d) => ({ label: d.name, icon: d.icon, cmd: 'insert.chart', args: { id: d.id } })),
    callout: () => MD.callouts.map((c) => ({ label: c.name, icon: 'callout', sub: c.text, cmd: 'insert.callout', args: { id: c.id }, preview: h('span.md-callout-dot.md-co-' + c.id.toLowerCase()) })),
    code: () => [...MD.codeLanguages.map(([id, name]) => ({ label: name, icon: 'code-block', cmd: 'insert.code', args: { lang: id } })), { sep: true }, { label: 'Python that runs (code chunk)', icon: 'run', cmd: 'insert.code', args: { lang: 'python', run: true, code: 'import math\nprint(f"π ≈ {math.pi:.5f}")' } }],
    math: () => MD.equations.map((q) => (q.inline ? { label: q.name, icon: 'sigma', cmd: 'insert.mathInline', shortcut: 'Mod+Shift+M' } : { label: q.name, icon: 'math', cmd: 'insert.math', args: { tex: q.tex }, sub: q.tex && !q.tex.includes(E.SEL) ? q.tex.replace(/\n/g, ' ').slice(0, 42) : '' })),
    table: (anchor) => tableGrid(anchor),
    newSlide: () => Object.entries(MD.slideLayouts).map(([id, L]) => ({ label: L.name, icon: L.icon, cmd: 'slides.new', args: { layout: id } })),
    layout: () => [...Object.entries(MD.slideLayouts).map(([id, L]) => ({ label: L.name, icon: L.icon, cmd: 'slides.layout', args: { layout: id } }))],
    paper: () => [['a4', 'A4 (210 × 297 mm)'], ['letter', 'Letter (8.5 × 11 in)'], ['a5', 'A5 (148 × 210 mm)'], ['legal', 'Legal (8.5 × 14 in)']].map(([id, label]) => ({ label, icon: 'page-size', cmd: 'design.paper', args: { id }, checked: (E.frontMatter().paper || 'a4') === id })),
    orientation: () => [['portrait', 'Portrait'], ['landscape', 'Landscape']].map(([id, label]) => ({ label, icon: 'orientation', cmd: 'design.orientation', args: { id }, checked: (E.frontMatter().orientation || 'portrait') === id })),
    margins: () => [['normal', 'Normal (2.5 cm)'], ['narrow', 'Narrow (1.27 cm)'], ['wide', 'Wide (3.5 cm)']].map(([id, label]) => ({ label, icon: 'margins', cmd: 'design.margins', args: { id }, checked: (E.frontMatter().margins || 'normal') === id })),
    watermark: () => [['DRAFT', 'Draft'], ['CONFIDENTIAL', 'Confidential'], ['DO NOT COPY', 'Do not copy'], ['SAMPLE', 'Sample'], ['URGENT', 'Urgent']].map(([text, label]) => ({ label, icon: 'watermark', cmd: 'design.watermark', args: { text }, checked: E.frontMatter().watermark === text }))
      .concat([{ sep: true }, { label: 'Custom watermark…', icon: 'watermark', cmd: 'design.watermark' }, { label: 'Remove watermark', icon: 'x', cmd: 'design.watermark', args: { text: '' } }]),
    present: () => [{ label: 'From beginning', icon: 'present', cmd: 'slides.present', shortcut: 'F5' }, { label: 'From current slide', icon: 'present-current', cmd: 'slides.presentCurrent', shortcut: 'Shift+F5' }],
    date: () => { const d = new Date(); return [d.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }), d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), d.toISOString().slice(0, 10), d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })].map((f) => ({ label: f, run: () => E.insert(f) })); },
    media: () => [{ label: 'Video or audio file…', icon: 'video', cmd: 'insert.video' }, { label: 'Online video (YouTube, Vimeo)…', icon: 'web', cmd: 'insert.online' }],
    chem: () => [{ label: '3D molecule (Mol*)', icon: 'molecule', cmd: 'insert.molecule' }, { label: 'Chemical structure (SMILES)', icon: 'molecule', cmd: 'insert.smiles' }, { label: 'Chemical equation', icon: 'math', cmd: 'insert.math', args: { tex: '\\ce{CH4 + 2O2 -> CO2 + 2H2O}' } }],
  };

  function tableGrid(anchor) {
    const N = 8, M = 10;
    const label = h('div.md-menu-header', 'Insert table');
    const grid = h('div.md-tgrid');
    for (let r = 0; r < M; r++) for (let c = 0; c < N; c++) { const cell = h('div.md-tcell'); cell.dataset.r = r; cell.dataset.c = c; grid.append(cell); }
    grid.addEventListener('mouseover', (e) => {
      const t = e.target.closest('.md-tcell'); if (!t) return;
      const R = +t.dataset.r, Cc = +t.dataset.c;
      grid.querySelectorAll('.md-tcell').forEach((x) => x.classList.toggle('on', +x.dataset.r <= R && +x.dataset.c <= Cc));
      label.textContent = (Cc + 1) + ' × ' + (R + 1) + ' table';
    });
    grid.addEventListener('click', (e) => { const t = e.target.closest('.md-tcell'); if (!t) return; MD.closeMenu(); MD.run('insert.table', { rows: +t.dataset.r + 1, cols: +t.dataset.c + 1 }); });
    const more = h('div.md-menu-list',
      menuButton('Insert table…', 'table', () => MD.run('insert.tableDialog')),
      menuButton('Table from a CSV file…', 'csv', () => MD.run('insert.csv')),
      menuButton('Tidy the table at the cursor', 'table', () => MD.run('table.format')));
    MD.popup(anchor, h('div', label, grid, h('div.md-menu-sep'), more));
    return null;
  }
  function menuButton(label, icon, run) {
    const b = h('button.md-menu-item', h('span.md-menu-check'), MD.icon(icon, 18), h('span.md-menu-label', label), h('span.md-menu-key'));
    b.addEventListener('click', () => { MD.closeMenu(); run(); });
    return b;
  }

  // ------------------------------------------------------------------ layout
  const L = (cmd, extra) => Object.assign({ cmd, size: 'large' }, extra || {});
  const s = (cmd, extra) => Object.assign({ cmd, size: 'small' }, extra || {});
  const i = (cmd, extra) => Object.assign({ cmd, size: 'icon' }, extra || {});
  const TABS = [
    { id: 'home', label: 'Home', groups: [
      { label: 'Clipboard', items: [L('edit.paste'), { col: [s('edit.cut'), s('edit.copy'), s('format.clear', { label: 'Clear formatting' })] }] },
      { label: 'Font', items: [{ rows: [[i('format.bold'), i('format.italic'), i('format.underline'), i('format.strike'), i('format.code')], [i('format.highlight'), i('format.sub'), i('format.sup'), i('format.clear'), i('insert.link')]] }] },
      { label: 'Paragraph', items: [{ rows: [[i('format.bullets'), i('format.numbering'), i('format.checklist'), i('format.outdent'), i('format.indent')], [i('format.quote'), i('insert.hr'), i('insert.callout', { menu: 'callout' }), i('insert.code', { menu: 'code' })]] }] },
      { label: 'Styles', items: [{ gallery: 'styles' }] },
      { label: 'Editing', items: [{ col: [s('edit.find'), s('edit.replace'), s('edit.selectAll')] }] },
    ] },
    { id: 'insert', label: 'Insert', groups: [
      { label: 'Pages', items: [{ col: [s('insert.cover'), s('insert.pagebreak'), s('insert.toc')] }] },
      { label: 'Tables', items: [L('insert.table', { menu: 'table', dropOnly: true })] },
      { label: 'Illustrations', items: [L('insert.picture'), L('insert.diagram', { menu: 'diagram' }), L('insert.chart', { menu: 'chart' }), { col: [s('insert.video', { label: 'Media', menu: 'media', dropOnly: true }), s('insert.molecule', { label: 'Chemistry', menu: 'chem', dropOnly: true }), s('insert.import', { label: 'Include file' })] }] },
      { label: 'Links', items: [L('insert.link'), { col: [s('insert.footnote'), s('insert.details', { label: 'Collapsible' })] }] },
      { label: 'Blocks', items: [L('insert.callout', { menu: 'callout' }), L('insert.code', { menu: 'code' }), L('insert.math', { menu: 'math' })] },
      { label: 'Text', items: [{ col: [s('insert.date', { menu: 'date', dropOnly: true }), s('insert.emoji'), s('insert.symbol')] }, L('insert.properties', { label: 'Properties' })] },
    ] },
    { id: 'design', label: 'Design', groups: [
      { label: 'Document themes', items: [{ gallery: 'themes' }] },
      { label: 'Page setup', items: [{ col: [s('design.paper', { menu: 'paper', dropOnly: true, label: 'Size' }), s('design.orientation', { menu: 'orientation', dropOnly: true }), s('design.margins', { menu: 'margins', dropOnly: true })] }] },
      { label: 'Page background', items: [L('design.watermark', { menu: 'watermark', dropOnly: true })] },
      { label: 'Formatting', items: [{ col: [s('design.numbered'), s('design.justify')] }] },
    ] },
    { id: 'slides', label: 'Slides', groups: [
      { label: 'Slides', items: [L('slides.new', { menu: 'newSlide' }), { gallery: 'layouts' }, { col: [s('slides.duplicate'), s('slides.delete'), s('slides.notes')] }, { col: [s('slides.up'), s('slides.down'), s('slides.background', { label: 'Background' })] }] },
      { label: 'Slide themes', items: [{ gallery: 'deckThemes' }] },
      { label: 'Start slide show', items: [L('slides.present'), L('slides.presentCurrent')] },
      { label: 'Outline', items: [L('slides.fromHeadings')] },
    ] },
    { id: 'review', label: 'Review', groups: [
      { label: 'Proofing', items: [L('review.spelling', { label: 'Spelling' }), L('review.wordcount')] },
      { label: 'Accessibility', items: [L('review.accessibility')] },
      { label: 'Structure', items: [L('review.outline'), { col: [s('table.format'), s('edit.goto')] }] },
    ] },
    { id: 'view', label: 'View', groups: [
      { label: 'Views', items: [L('view.write'), L('view.split'), L('view.read'), L('slides.present', { label: 'Present', menu: 'present' })] },
      { label: 'Show', items: [{ col: [s('view.nav'), s('view.lineNumbers'), s('view.wrap')] }, { col: [s('view.sync'), s('review.spelling', { label: 'Spelling' }), s('view.focus', { label: 'Focus mode' })] }] },
      { label: 'Zoom', items: [L('view.zoomReset'), { col: [s('view.zoomIn'), s('view.zoomOut'), s('view.pageWidth')] }] },
      { label: 'Interface', items: [{ col: [s('view.light'), s('view.dark'), s('view.system')] }, L('view.darkPage')] },
      { label: 'Preview', items: [{ col: [s('view.refresh'), s('view.mathEngine'), s('view.runCode')] }] },
      { label: 'Window', items: [L('file.newWindow'), { col: [s('view.ribbon'), s('help.shortcuts'), s('help.search')] }] },
    ] },
    { id: 'table', label: 'Table', contextual: true, groups: [
      { label: 'Rows & columns', items: [L('table.addRow'), L('table.addCol'), L('table.delRow')] },
      { label: 'Format', items: [L('table.format')] },
    ] },
  ];
  MD.ribbonTabs = TABS;

  // ------------------------------------------------------------------ rendering
  const ribbon = document.getElementById('md-ribbon');
  const tabsEl = document.getElementById('md-tabs');
  let current = 'home';
  let peek = false;

  function button(it) {
    const c = MD.command(it.cmd);
    if (!c) { console.warn('ribbon: no command', it.cmd); return null; }
    const label = it.label || c.label;
    const tip = (c.label + (c.key ? ' (' + MD.keyLabel(c.key) + ')' : '')).replace(/…$/, '');
    const b = h('button.md-rb.md-rb-' + it.size, { title: tip, dataset: { cmd: it.cmd } });
    if (it.args) b.dataset.args = JSON.stringify(it.args);
    const iconSize = it.size === 'large' ? 30 : 18;
    if (it.size === 'large') b.append(MD.icon(c.icon, iconSize), h('span.md-rb-label', label, it.menu ? h('span.md-caret', MD.icon('caret', 12)) : null));
    else if (it.size === 'small') { b.append(MD.icon(c.icon, iconSize), h('span.md-rb-label', label)); if (it.menu) b.append(h('span.md-caret', MD.icon('caret', 12))); }
    else b.append(MD.icon(c.icon, iconSize));
    if (it.menu && it.dropOnly) {
      b.dataset.menu = it.menu;
      return b;
    }
    if (it.menu) {
      // split button: the main part runs the command, the arrow opens the menu
      const wrap = h('div.md-split-btn.md-split-' + it.size);
      const arrow = h('button.md-rb-arrow', { title: label + ' options', dataset: { menu: it.menu } }, MD.icon('caret', 12));
      if (it.size === 'large') b.querySelector('.md-caret')?.remove();
      wrap.append(b, arrow);
      return wrap;
    }
    return b;
  }

  function gallery(kind) {
    const g = h('div.md-gallery.md-gallery-' + kind, { dataset: { gallery: kind } });
    if (kind === 'styles') {
      const styles = [['format.normal', 'Normal', 'p'], ['format.h1', 'Heading 1', 'h1'], ['format.h2', 'Heading 2', 'h2'], ['format.h3', 'Heading 3', 'h3'], ['format.h4', 'Heading 4', 'h4'], ['format.quote', 'Quote', 'q'], ['format.code', 'Code', 'c']];
      for (const [cmd, name, tag] of styles) g.append(h('button.md-style-tile.md-st-' + tag, { dataset: { cmd }, title: name + (MD.command(cmd).key ? ' (' + MD.keyLabel(MD.command(cmd).key) + ')' : '') }, h('span.md-style-sample', tag === 'c' ? 'AaBb' : 'AaBbCc'), h('span.md-style-name', name)));
    } else if (kind === 'themes' || kind === 'deckThemes') {
      const list = MD.themes.filter((t) => (kind === 'themes' ? t.kind === 'document' : t.kind === 'deck'));
      for (const t of list) {
        const tile = h('button.md-theme-tile', { dataset: { cmd: 'design.theme', args: JSON.stringify({ id: t.id }) }, title: t.name + ' theme' },
          h('span.md-theme-preview.theme-swatch-' + t.id, { style: { background: t.kind === 'deck' ? t.colors[0] : '#fff', fontFamily: '"' + t.font + '", sans-serif' } },
            h('span.md-theme-aa', { style: { color: t.kind === 'deck' ? t.colors[2] : t.colors[0] } }, 'Aa'),
            h('span.md-theme-bars', ...t.colors.map((c) => h('i', { style: { background: c } })))),
          h('span.md-theme-name', t.name));
        g.append(tile);
      }
    } else if (kind === 'layouts') {
      for (const [id, Lay] of Object.entries(MD.slideLayouts)) {
        if (id === 'blank' || id === 'image') continue;
        g.append(h('button.md-layout-tile', { dataset: { cmd: 'slides.layout', args: JSON.stringify({ layout: id }) }, title: 'Layout: ' + Lay.name }, MD.icon(Lay.icon, 26), h('span', Lay.name.replace(' slide', '').replace('Title and content', 'Content').replace('Section header', 'Section').replace('Two content', 'Two columns'))));
      }
    }
    return g;
  }

  function renderTab(id) {
    const tab = TABS.find((t) => t.id === id) || TABS[0];
    const body = h('div.md-rb-body');
    for (const grp of tab.groups) {
      const content = h('div.md-rb-content');
      for (const it of grp.items) {
        if (it.gallery) content.append(gallery(it.gallery));
        else if (it.col) content.append(h('div.md-rb-col', it.col.map(button)));
        else if (it.rows) content.append(h('div.md-rb-rows', it.rows.map((r) => h('div.md-rb-row', r.map(button)))));
        else content.append(button(it));
      }
      body.append(h('div.md-rb-group', content, h('div.md-rb-glabel', grp.label)));
    }
    ribbon.replaceChildren(body);
    MDIcons.fill(ribbon);
    refresh();
  }

  function renderTabs() {
    tabsEl.replaceChildren(...TABS.filter((t) => !t.contextual || contextualVisible(t)).map((t) =>
      h('button.md-tab', { role: 'tab', class: (t.id === current ? 'on' : '') + (t.contextual ? ' md-tab-ctx' : ''), dataset: { tab: t.id } }, t.label)));
  }
  function contextualVisible(t) { return t.id === 'table' && tableActive; }
  let tableActive = false;

  MD.selectTab = (id) => {
    current = id;
    renderTabs();
    renderTab(id);
    if (MD.pref && MD.pref('ribbonCollapsed')) { peek = true; document.body.classList.add('md-ribbon-peek'); }
  };
  MD.currentTab = () => current;

  tabsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    if (MD.backstageOpen()) MD.closeBackstage();
    MD.selectTab(b.dataset.tab);
  });
  tabsEl.addEventListener('dblclick', (e) => { if (e.target.closest('[data-tab]')) MD.run('view.ribbon'); });

  // clicks on anything with data-cmd (ribbon, status bar, backstage)
  document.addEventListener('click', (e) => {
    const arrow = e.target.closest('[data-menu]');
    if (arrow && (arrow.classList.contains('md-rb-arrow') || arrow.classList.contains('md-rb'))) {
      e.preventDefault();
      const m = menus[arrow.dataset.menu];
      if (m) { const items = m(arrow); if (items) MD.menu(arrow, items); }
      return;
    }
    const el = e.target.closest('[data-cmd]');
    if (!el || el.disabled) return;
    if (el.closest('.md-menu')) return; // menus handle their own clicks
    e.preventDefault();
    const args = el.dataset.args ? JSON.parse(el.dataset.args) : undefined;
    const withAnchor = args ? Object.assign({ anchor: el }, args) : { anchor: el };
    MD.run(el.dataset.cmd, el.dataset.args ? withAnchor : (['insert.emoji', 'insert.symbol', 'slides.background', 'insert.date'].includes(el.dataset.cmd) ? { anchor: el } : undefined));
    if (peek && el.closest('#md-ribbon')) { peek = false; document.body.classList.remove('md-ribbon-peek'); }
  });
  document.addEventListener('mousedown', (e) => {
    if (peek && !e.target.closest('#md-top') && !e.target.closest('.md-menu')) { peek = false; document.body.classList.remove('md-ribbon-peek'); }
  });

  // ------------------------------------------------------------------ state (checked / enabled)
  let refreshTimer = null;
  function refresh() {
    MD.updateFormatState();
    const wasTable = tableActive;
    tableActive = E.inTable();
    if (wasTable !== tableActive) { renderTabs(); if (!tableActive && current === 'table') MD.selectTab('home'); }
    for (const el of document.querySelectorAll('#md-ribbon [data-cmd], #md-status [data-cmd]')) {
      const c = MD.command(el.dataset.cmd);
      if (!c) continue;
      const args = el.dataset.args ? JSON.parse(el.dataset.args) : undefined;
      if (c.checked) el.classList.toggle('on', !!c.checked(args));
      if (c.enabled) el.disabled = !c.enabled();
    }
  }
  MD.refreshRibbon = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 60); };

  // ------------------------------------------------------------------ command search (Alt+Q)
  const search = document.getElementById('md-search');
  const results = document.getElementById('md-search-results');
  let hits = [];
  let sel = 0;
  function score(c, q) {
    const label = c.label.toLowerCase(), kw = (c.keywords || '').toLowerCase(), id = c.id.toLowerCase();
    if (label.startsWith(q)) return 3;
    if (label.split(/\s+/).some((w) => w.startsWith(q))) return 2.5;
    if (label.includes(q)) return 2;
    if (q.split(/\s+/).every((w) => label.includes(w) || kw.includes(w) || id.includes(w))) return 1;
    return 0;
  }
  function showResults() {
    const q = search.value.trim().toLowerCase();
    if (!q) { results.hidden = true; return; }
    hits = [...MD.commands.values()].filter((c) => !c.hidden).map((c) => [c, score(c, q)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([c]) => c);
    // templates too
    sel = 0;
    results.replaceChildren(...hits.map((c, i) => h('button.md-menu-item' + (i === sel ? '.sel' : ''), { dataset: { i } }, h('span.md-menu-check'), MD.icon(c.icon, 18), h('span.md-menu-label', c.label), h('span.md-menu-key', MD.keyLabel(c.key || '')))));
    if (!hits.length) results.replaceChildren(h('div.md-menu-header', 'No commands match “' + search.value + '”'));
    results.hidden = false;
  }
  function pick(i) {
    const c = hits[i];
    if (!c) return;
    results.hidden = true; search.value = ''; search.blur();
    MD.run(c.id);
  }
  search.addEventListener('input', showResults);
  search.addEventListener('focus', showResults);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % Math.max(1, hits.length);
      results.querySelectorAll('.md-menu-item').forEach((b, i) => b.classList.toggle('sel', i === sel));
    } else if (e.key === 'Enter') { e.preventDefault(); pick(sel); }
    else if (e.key === 'Escape') { e.preventDefault(); search.value = ''; results.hidden = true; E.focus(); }
  });
  results.addEventListener('mousedown', (e) => { const b = e.target.closest('[data-i]'); if (b) { e.preventDefault(); pick(+b.dataset.i); } });
  search.addEventListener('blur', () => setTimeout(() => { results.hidden = true; }, 150));

  MD.renderRibbon = () => { renderTabs(); renderTab(current); };
})();
