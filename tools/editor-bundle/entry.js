// CodeMirror 6 for mdcraft's editor pane, exposed as the global `CM`.
export { EditorState, EditorSelection, Compartment, StateEffect, StateField, Transaction } from '@codemirror/state';
export { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor,
  rectangularSelection, crosshairCursor, highlightSpecialChars, placeholder, ViewPlugin, Decoration, scrollPastEnd } from '@codemirror/view';
export { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo, selectAll, indentMore, indentLess,
  toggleComment, cursorDocStart, cursorDocEnd } from '@codemirror/commands';
export { markdown, markdownLanguage, markdownKeymap } from '@codemirror/lang-markdown';
export { syntaxHighlighting, HighlightStyle, indentOnInput, bracketMatching, foldGutter, foldKeymap, LanguageDescription,
  LanguageSupport, StreamLanguage } from '@codemirror/language';
export { search, searchKeymap, openSearchPanel, closeSearchPanel, highlightSelectionMatches, SearchQuery, setSearchQuery,
  findNext, findPrevious, replaceNext, replaceAll, getSearchQuery } from '@codemirror/search';
export { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
export { tags } from '@lezer/highlight';
import { LanguageDescription } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { rust } from '@codemirror/lang-rust';
import { yaml } from '@codemirror/lang-yaml';
import { sql } from '@codemirror/lang-sql';
/** Languages highlighted inside fenced code blocks. */
export const codeLanguages = [
  LanguageDescription.of({ name: 'JavaScript', alias: ['js', 'javascript', 'ts', 'typescript', 'jsx', 'tsx'], support: javascript({ typescript: true, jsx: true }) }),
  LanguageDescription.of({ name: 'Python', alias: ['py', 'python'], support: python() }),
  LanguageDescription.of({ name: 'JSON', alias: ['json', 'chart', 'vega-lite', 'vega', 'plotly', 'wavedrom'], support: json() }),
  LanguageDescription.of({ name: 'CSS', alias: ['css'], support: css() }),
  LanguageDescription.of({ name: 'HTML', alias: ['html', 'xml', 'svg'], support: html() }),
  LanguageDescription.of({ name: 'Rust', alias: ['rs', 'rust'], support: rust() }),
  LanguageDescription.of({ name: 'YAML', alias: ['yaml', 'yml'], support: yaml() }),
  LanguageDescription.of({ name: 'SQL', alias: ['sql'], support: sql() }),
];
