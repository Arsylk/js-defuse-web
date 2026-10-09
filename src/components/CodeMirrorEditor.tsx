import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { EditorState } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  rectangularSelection,
  crosshairCursor,
  highlightActiveLine,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import {
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  foldKeymap,
  indentUnit,
} from '@codemirror/language';
import { search, searchKeymap } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { mocha } from 'js-defuser/logger';

// ── Catppuccin Mocha editor theme ─────────────────────────────────────────────
const catppuccinTheme = EditorView.theme({
  '&': {
    color: mocha.text,
    backgroundColor: mocha.base,
    height: '100%',
    fontFamily: '"JetBrains Mono","Fira Code","Cascadia Code",ui-monospace,monospace',
    fontSize: '13px',
  },
  '.cm-content': { padding: '12px 0', caretColor: mocha.blue },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: mocha.blue, borderLeftWidth: '2px' },
  '&.cm-focused .cm-cursor': { borderLeftColor: mocha.blue },
  '.cm-selectionBackground': { backgroundColor: `${mocha.surface1}88 !important` },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: `${mocha.surface1} !important` },
  '&.cm-focused': { outline: 'none' },
  '.cm-line': { padding: '0 16px', lineHeight: '1.75' },
  '.cm-gutters': {
    backgroundColor: mocha.mantle,
    color: mocha.surface1,
    border: 'none',
    borderRight: `1px solid ${mocha.surface0}`,
    minWidth: '48px',
  },
  '.cm-activeLineGutter': { backgroundColor: '#25253a', color: mocha.overlay1 },
  '.cm-activeLine': { backgroundColor: '#25253a55' },
  '.cm-matchingBracket': {
    backgroundColor: `${mocha.surface1}80`,
    outline: `1px solid ${mocha.blue}66`,
  },
  '.cm-nonmatchingBracket': { color: `${mocha.red} !important` },
  '.cm-foldGutter .cm-gutterElement': { cursor: 'pointer', padding: '0 4px' },
  '.cm-foldGutter .cm-gutterElement:hover': { color: mocha.blue },
  '.cm-selectionMatch': { backgroundColor: mocha.surface0, outline: `1px solid ${mocha.surface1}` },
  '.cm-searchMatch': { backgroundColor: `${mocha.peach}55`, outline: `1px solid ${mocha.peach}` },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: `${mocha.red}55` },
  '.cm-tooltip': {
    backgroundColor: mocha.surface0,
    border: `1px solid ${mocha.surface1}`,
    color: mocha.text,
    borderRadius: '6px',
  },
  '.cm-panels': { backgroundColor: mocha.mantle, color: mocha.text },
  '.cm-panel.cm-search': {
    backgroundColor: mocha.mantle,
    borderTop: `1px solid ${mocha.surface1}`,
    padding: '8px 12px',
    gap: '6px',
  },
  '.cm-textfield': {
    backgroundColor: mocha.surface0,
    border: `1px solid ${mocha.surface1}`,
    color: mocha.text,
    borderRadius: '5px',
    padding: '3px 8px',
    fontFamily: 'inherit',
  },
  '.cm-button': {
    backgroundColor: mocha.blue,
    color: mocha.base,
    border: 'none',
    borderRadius: '5px',
    padding: '3px 10px',
    cursor: 'pointer',
    fontWeight: '600',
  },
  '.cm-scroller': { overflow: 'auto', lineHeight: '1.75' },
  '.cm-placeholder': { color: mocha.overlay0 },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 6px', userSelect: 'none' },
  // Error squiggle underline via lint
  '.cm-lint-marker-error': { color: `${mocha.red} !important` },
  '.cm-lint-marker-warning': { color: `${mocha.yellow} !important` },
  '.cm-lintRange-error': {
    backgroundImage:
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='3'%3E%3Cpath d='M0 2.5 L2 0.5 L4 2.5 L6 0.5' stroke='%23f38ba8' fill='none' stroke-width='1'/%3E%3C/svg%3E\")",
    backgroundRepeat: 'repeat-x',
    backgroundPosition: 'bottom',
    paddingBottom: '2px',
  },
  '.cm-lintRange-warning': {
    backgroundImage:
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='3'%3E%3Cpath d='M0 2.5 L2 0.5 L4 2.5 L6 0.5' stroke='%23f9e2af' fill='none' stroke-width='1'/%3E%3C/svg%3E\")",
    backgroundRepeat: 'repeat-x',
    backgroundPosition: 'bottom',
    paddingBottom: '2px',
  },
});

export interface EditorDiagnostic {
  /** 1-based line number */
  line: number;
  /** 0-based column */
  col?: number;
  message: string;
  /** Defaults to 'error'. Use 'warning' for browser-tolerant issues. */
  severity?: 'error' | 'warning';
}

export interface EditorHandle {
  /** Jump the editor cursor & scroll to a 1-based line, 0-based col */
  jumpTo: (line: number, col?: number) => void;
}

function buildExtensions(readOnly: boolean, diagnosticsFn: (view: EditorView) => Diagnostic[]) {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    indentUnit.of('  '),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    search({ top: false }),
    javascript({ jsx: false, typescript: false }),
    catppuccinTheme,
    EditorState.readOnly.of(readOnly),
    // Only add linting on the writable (input) editor
    ...(!readOnly ? [lintGutter(), linter(diagnosticsFn, { delay: 0 })] : []),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
    ]),
  ];
}

interface Props {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  className?: string;
  style?: React.CSSProperties;
  /** Parse errors to underline in red in the editor */
  diagnostics?: EditorDiagnostic[];
}

const CodeMirrorEditor = forwardRef<EditorHandle, Props>(function CodeMirrorEditor(
  { value, onChange, readOnly = false, className = '', style, diagnostics },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Always-fresh reference to diagnostics for the linter closure
  const diagnosticsRef = useRef<EditorDiagnostic[]>(diagnostics ?? []);
  diagnosticsRef.current = diagnostics ?? [];

  // Expose jumpTo so page.tsx can scroll to an error
  useImperativeHandle(ref, () => ({
    jumpTo(line: number, col = 0) {
      const view = viewRef.current;
      if (!view) return;
      try {
        const doc = view.state.doc;
        const lineObj = doc.line(Math.max(1, Math.min(line, doc.lines)));
        const pos = Math.min(lineObj.from + col, lineObj.to);
        view.dispatch({
          selection: { anchor: pos },
          effects: EditorView.scrollIntoView(pos, { y: 'center' }),
        });
        view.focus();
      } catch {
        /**/
      }
    },
  }));

  // Initialise editor once per readOnly value
  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && onChangeRef.current) {
        onChangeRef.current(update.state.doc.toString());
      }
    });

    // Linter callback reads the ref so it always uses the latest diagnostics
    const diagnosticsFn = (view: EditorView): Diagnostic[] => {
      const diags = diagnosticsRef.current;
      if (!diags.length) return [];
      const doc = view.state.doc;
      return diags.flatMap((d): Diagnostic[] => {
        try {
          const lineObj = doc.line(Math.max(1, Math.min(d.line, doc.lines)));
          const from = Math.min(lineObj.from + (d.col ?? 0), lineObj.to);
          const to = Math.max(from + 1, lineObj.to);
          return [
            {
              from,
              to,
              severity: (d.severity ?? 'error') as Diagnostic['severity'],
              message: d.message,
            },
          ];
        } catch {
          return [];
        }
      });
    };

    const state = EditorState.create({
      doc: value,
      extensions: [...buildExtensions(readOnly, diagnosticsFn), updateListener],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  // Sync external value without re-creating the editor
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  // Re-trigger lint whenever diagnostics change
  useEffect(() => {
    const view = viewRef.current;
    if (!view || readOnly) return;
    view.dispatch({}); // empty transaction forces linter re-run
  }, [diagnostics, readOnly]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ height: '100%', overflow: 'hidden', ...style }}
    />
  );
});

export default CodeMirrorEditor;
