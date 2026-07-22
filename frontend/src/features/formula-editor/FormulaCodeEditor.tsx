import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import { linter, type Diagnostic } from '@codemirror/lint';
import { EditorView, keymap } from '@codemirror/view';
import { python } from '@codemirror/lang-python';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import type { FormulaDiagnostic } from '../../types/formula';
import { getFormulaSymbolDictionary } from './formulaDictionary';
import type { FormulaSymbols } from './formulaParser';

export interface FormulaCodeEditorHandle {
  insert: (text: string) => void;
  focus: () => void;
  focusRange: (start: number, end: number) => void;
}

interface FormulaCodeEditorProps {
  value: string;
  symbols: FormulaSymbols;
  diagnostics?: FormulaDiagnostic[];
  onChange: (value: string) => void;
  onCompile?: () => void;
}

const builtins = [
  { label: 'sum', detail: '聚合求和', apply: 'sum(value for i in set)' },
  { label: 'min', detail: '聚合最小值', apply: 'min(value for i in set)' },
  { label: 'max', detail: '聚合最大值', apply: 'max(value for i in set)' },
  { label: 'abs', detail: '绝对值（需后端确认支持）', apply: 'abs(value)' },
  { label: 'piecewise', detail: '分段线性函数资产', apply: 'piecewise(x, curve_id)' },
];

export function formulaCompletionOptions(symbols: FormulaSymbols) {
  return [
    ...getFormulaSymbolDictionary({ symbols }).map(item => ({
      label: item.code,
      displayLabel: item.name === item.code ? item.code : `${item.code} · ${item.name}`,
      detail: `${item.typeLabel}${item.unit ? ` · ${item.unit}` : ''}`,
      type: item.type === 'variable' ? 'variable' : item.type === 'parameter' ? 'constant' : 'keyword',
      apply: item.type === 'set' ? item.code : `${item.code}${item.indices?.length ? `[${item.indices.join(',')}]` : ''}`,
    })),
    ...builtins.map(item => ({ ...item, type: 'function' })),
  ];
}

export const FormulaCodeEditor = forwardRef<FormulaCodeEditorHandle, FormulaCodeEditorProps>(function FormulaCodeEditor(
  { value, symbols, diagnostics = [], onChange, onCompile },
  ref,
) {
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const completionOptions = useMemo(() => formulaCompletionOptions(symbols), [symbols]);

  const extensions = useMemo(() => {
    const completionSource = (context: CompletionContext) => {
      const word = context.matchBefore(/[A-Za-z_][\w]*/);
      if (!word && !context.explicit) return null;
      return {
        from: word?.from ?? context.pos,
        options: [
          ...completionOptions,
        ],
      };
    };
    const diagnosticsExtension = linter(view => diagnostics.map(item => {
      const length = view.state.doc.length;
      return {
        from: Math.max(0, Math.min(item.start, length)),
        to: Math.max(0, Math.min(Math.max(item.end, item.start + 1), length)),
        severity: item.severity,
        message: item.fixHint ? `${item.message}\n建议：${item.fixHint}` : item.message,
        source: `权威编译 · ${item.stage}`,
      } satisfies Diagnostic;
    }));
    return [
      python(),
      autocompletion({ override: [completionSource], activateOnTyping: true }),
      diagnosticsExtension,
      EditorView.lineWrapping,
      keymap.of([{ key: 'Mod-Enter', run: () => { onCompile?.(); return true; } }]),
      EditorView.theme({
        '&': { fontSize: '14px', minHeight: '168px' },
        '.cm-content': { fontFamily: 'JetBrains Mono, Consolas, monospace', padding: '12px 0' },
        '.cm-gutters': { backgroundColor: '#f7f9fc', color: '#8291a8', borderRight: '1px solid #e4e9f0' },
        '.cm-activeLine': { backgroundColor: '#eef6ff' },
        '&.cm-focused': { outline: '2px solid rgba(22, 119, 255, .18)' },
      }),
    ];
  }, [completionOptions, diagnostics, onCompile]);

  useImperativeHandle(ref, () => ({
    insert(text: string) {
      const view = editorRef.current?.view;
      if (!view) return;
      const selection = view.state.selection.main;
      const source = view.state.doc.toString();
      const left = selection.from > 0 && !/\s$/.test(source.slice(0, selection.from)) ? ' ' : '';
      const right = selection.to < source.length && !/^\s/.test(source.slice(selection.to)) ? ' ' : '';
      const inserted = `${left}${text}${right}`;
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: inserted },
        selection: { anchor: selection.from + left.length + text.length },
      });
      view.focus();
    },
    focus() { editorRef.current?.view?.focus(); },
    focusRange(start: number, end: number) {
      const view = editorRef.current?.view;
      if (!view) return;
      const length = view.state.doc.length;
      const from = Math.max(0, Math.min(start, length));
      const to = Math.max(from, Math.min(end, length));
      view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
      view.focus();
    },
  }), []);

  return (
    <div className="formula-code-editor" data-testid="formula-code-editor">
      <CodeMirror
        ref={editorRef}
        value={value}
        height="168px"
        aria-label="公式表达式"
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: false,
          searchKeymap: true,
          foldGutter: true,
        }}
        extensions={extensions}
        onChange={onChange}
        placeholder="sum(unit_output[u,t] for u in unit) >= load_forecast[t]"
      />
      <div className="formula-code-editor-hint">Ctrl+Space 补全 · Ctrl+F 搜索 · Ctrl+Enter 权威编译</div>
    </div>
  );
});
