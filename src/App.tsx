import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  Braces,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  FileCode,
  FlaskConical,
  Layers,
  Link,
  Play,
  RotateCcw,
  Settings,
  Square,
  X,
  Zap,
} from 'lucide-react';
import { mocha, segments, tones, type Entry } from 'js-defuser/logger';
import CodeMirrorEditor, { type EditorDiagnostic, type EditorHandle } from './components/CodeMirrorEditor';
import ASTExplorer, { type AnyNode, type NodeRange } from './components/ASTExplorer';
import { EngineClient } from './engine-client';
import type { ParseError, PipelineStage } from './protocol';

// ── Catppuccin Mocha — one palette for the ui and the logger ─────────────────
const C = mocha;

interface Example {
  id: string;
  name: string;
  description: string;
  file?: string;
  inline?: string;
}

/** One problem to show in the Errors tab, anchored in an editor when it has a position. */
interface Diagnostic {
  severity: 'error' | 'warning';
  source: 'input' | 'output' | 'engine';
  message: string;
  line?: number;
  col?: number;
  endLine?: number;
  endCol?: number;
}

// ── helpers ───────────────────────────────────────────────────────────────────
/** base64url of the UTF-8 text, for `#code=` links (no server involved). */
function encodeCode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeCode(packed: string): string {
  const bin = atob(packed.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function byteFmt(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}

/** `12:5` or `12:5–14:1`, 1-based line and character as editors show them. */
function anchorLabel(d: Pick<Diagnostic, 'line' | 'col' | 'endLine' | 'endCol'>): string | null {
  if (d.line === undefined) return null;
  const a = `${d.line}:${(d.col ?? 0) + 1}`;
  if (d.endLine !== undefined && (d.endLine !== d.line || (d.endCol ?? 0) !== (d.col ?? 0))) return `${a}–${d.endLine}:${(d.endCol ?? 0) + 1}`;
  return a;
}

const toastStyle = (kind: 'ok' | 'warn' | 'error'): React.CSSProperties => ({
  position: 'fixed',
  bottom: 24,
  right: 24,
  zIndex: 50,
  padding: '9px 14px',
  borderRadius: 8,
  fontSize: 13,
  backgroundColor: C.surface0,
  color: kind === 'error' ? C.red : kind === 'warn' ? C.yellow : C.green,
  border: `1px solid ${C.surface1}`,
  boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
  pointerEvents: 'none',
});

const chip = (color: string, bg: string = C.surface0): React.CSSProperties => ({
  fontSize: 10,
  lineHeight: '16px',
  fontFamily: 'ui-monospace, monospace',
  color,
  backgroundColor: bg,
  border: `1px solid ${C.surface1}`,
  borderRadius: 4,
  padding: '0 5px',
  whiteSpace: 'nowrap',
  flexShrink: 0,
});

// ── Log line ──────────────────────────────────────────────────────────────────
function LogLine({ entry }: { entry: Entry }) {
  const Icon =
    entry.kind === 'error' || (entry.kind === 'pass' && entry.status === 'failed')
      ? AlertCircle
      : entry.kind === 'ok' || entry.kind === 'done'
        ? CheckCircle
        : null;
  const iconColor = Icon === AlertCircle ? C.red : C.green;
  return (
    <div className="flex items-start gap-2 py-0.5">
      {Icon ? <Icon size={11} style={{ color: iconColor, marginTop: 2, flexShrink: 0 }} /> : <span style={{ width: 11, flexShrink: 0 }} />}
      <span className="font-mono text-xs leading-5 whitespace-pre-wrap break-all">
        {segments(entry).map((seg, i) => (
          <span
            key={i}
            style={{
              color: seg.role ? mocha[tones[seg.role]] : undefined,
              fontWeight: seg.bold ? 600 : undefined,
              opacity: seg.dim ? 0.7 : undefined,
            }}
          >
            {seg.text}
          </span>
        ))}
      </span>
    </div>
  );
}

// ── Diagnostic row ────────────────────────────────────────────────────────────
function DiagnosticRow({ d, onJump }: { d: Diagnostic; onJump: (d: Diagnostic) => void }) {
  const Icon = d.severity === 'error' ? AlertCircle : AlertTriangle;
  const color = d.severity === 'error' ? C.red : C.yellow;
  const anchor = anchorLabel(d);
  const sourceColor = d.source === 'input' ? C.red : d.source === 'output' ? C.green : C.mauve;
  return (
    <div className="flex items-start gap-2" style={{ padding: '4px 0', borderBottom: `1px solid ${C.surface0}` }}>
      <Icon size={12} style={{ color, marginTop: 3, flexShrink: 0 }} />
      {anchor ? (
        <button
          onClick={() => onJump(d)}
          title={d.endLine !== undefined ? 'Select this range' : 'Jump to this position'}
          className="font-mono"
          style={{
            fontSize: 11,
            lineHeight: '18px',
            color: C.blue,
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            textDecoration: 'underline dotted',
            textUnderlineOffset: 3,
            flexShrink: 0,
            minWidth: 52,
            textAlign: 'left',
          }}
        >
          {anchor}
        </button>
      ) : (
        <span className="font-mono" style={{ fontSize: 11, lineHeight: '18px', color: C.overlay0, flexShrink: 0, minWidth: 52 }}>
          —
        </span>
      )}
      <span style={{ ...chip(sourceColor), marginTop: 1 }}>{d.source}</span>
      <span className="font-mono text-xs whitespace-pre-wrap break-all" style={{ color: C.text, lineHeight: '18px' }}>
        {d.message.split('\n')[0]}
      </span>
    </div>
  );
}

// ── Pass row ──────────────────────────────────────────────────────────────────
function PassRow({ step, enabled, onToggle }: { step: PipelineStage['steps'][number]; enabled: boolean; onToggle: () => void }) {
  return (
    <div
      role="checkbox"
      aria-checked={enabled}
      onClick={onToggle}
      className="cursor-pointer select-none"
      style={{
        display: 'grid',
        gridTemplateColumns: '16px 1fr',
        columnGap: 10,
        padding: '7px 10px',
        borderRadius: 7,
        backgroundColor: enabled ? C.surface0 : 'transparent',
        border: `1px solid ${enabled ? C.surface1 : 'transparent'}`,
        transition: 'background 0.12s',
      }}
    >
      <div
        style={{
          width: 16,
          height: 16,
          marginTop: 1,
          borderRadius: 4,
          backgroundColor: enabled ? C.blue : C.surface1,
          border: `1px solid ${enabled ? C.blue : C.surface2}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {enabled && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path d="M1 4l3 3 5-6" stroke={C.base} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span style={chip(enabled ? C.sapphire : C.overlay0)}>{step.logId ?? step.stage}</span>
          <span className="font-mono text-xs font-semibold truncate" style={{ color: enabled ? C.text : C.subtext0 }}>
            {step.name}
          </span>
          {step.runs > 1 && <span style={chip(C.peach)}>×{step.runs}</span>}
          {!step.enabled_by_default && <span style={chip(C.overlay0, 'transparent')}>opt-in</span>}
        </div>
        <p className="text-xs leading-snug" style={{ color: C.overlay0, marginTop: 3 }}>
          {step.description}
        </p>
      </div>
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
      <div
        onClick={onChange}
        style={{
          width: 30,
          height: 17,
          borderRadius: 9,
          backgroundColor: on ? C.blue : C.surface1,
          position: 'relative',
          cursor: 'pointer',
          flexShrink: 0,
          transition: 'background 0.15s',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 2,
            left: on ? 15 : 2,
            width: 13,
            height: 13,
            borderRadius: '50%',
            backgroundColor: 'white',
            transition: 'left 0.15s',
          }}
        />
      </div>
      <span style={{ fontSize: 12, color: C.subtext0 }}>{label}</span>
    </label>
  );
}

const headerButton = (opts: { primary?: boolean; disabled?: boolean; color?: string } = {}): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  padding: opts.primary ? '7px 16px' : '7px 12px',
  borderRadius: 7,
  border: opts.primary ? 'none' : `1px solid ${C.surface1}`,
  cursor: opts.disabled ? 'default' : 'pointer',
  backgroundColor: opts.primary ? (opts.disabled ? C.surface1 : C.blue) : 'transparent',
  color: opts.primary ? (opts.disabled ? C.subtext0 : C.base) : (opts.color ?? C.subtext0),
  fontSize: 13,
  fontWeight: opts.primary ? 700 : 500,
  opacity: opts.disabled ? 0.4 : 1,
  textDecoration: 'none',
  whiteSpace: 'nowrap',
});

const smallButton: React.CSSProperties = {
  flex: 1,
  fontSize: 11,
  padding: '4px 0',
  borderRadius: 5,
  border: `1px solid ${C.surface1}`,
  backgroundColor: 'transparent',
  color: C.subtext0,
  cursor: 'pointer',
};

// ── main ──────────────────────────────────────────────────────────────────────
export default function App() {
  const engine = useMemo(() => new EngineClient(), []);
  const [engineReady, setEngineReady] = useState(false);
  const [inputCode, setInputCode] = useState('');
  const [outputCode, setOutputCode] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [pipeline, setPipeline] = useState<PipelineStage[]>([]);
  const [defaults, setDefaults] = useState<string[]>([]);
  const [selectedPasses, setSelectedPasses] = useState<string[]>([]);
  const [analysisLog, setAnalysisLog] = useState<Entry[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [lenientMode, setLenientMode] = useState(false);
  const [autoFix, setAutoFix] = useState(true);
  const [parsedAST, setParsedAST] = useState<unknown>(null);
  const [examples, setExamples] = useState<Example[]>([]);
  const [showExamples, setShowExamples] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [newerBuild, setNewerBuild] = useState<string | null>(null);
  const inputEditorRef = useRef<EditorHandle>(null);
  const outputEditorRef = useRef<EditorHandle>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number | null>(null);

  // panel visibility
  const [showPasses, setShowPasses] = useState(true);
  const [showAST, setShowAST] = useState(true);
  const [showConsole, setShowConsole] = useState(true);
  const [consoleTab, setConsoleTab] = useState<'log' | 'errors'>('log');
  const consoleHeight = 220;

  // metrics
  const [metrics, setMetrics] = useState<{ orig: number; final: number; reduction: string } | null>(null);

  const allSteps = useMemo(() => pipeline.flatMap((s) => s.steps), [pipeline]);
  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const warningCount = diagnostics.length - errorCount;

  const notify = useCallback((kind: 'ok' | 'warn' | 'error', text: string) => {
    setToast({ kind, text });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    engine.getCatalog().then(({ pipeline, defaults }) => {
      setPipeline(pipeline);
      setDefaults(defaults);
      setSelectedPasses(pipeline.flatMap((s) => s.steps).filter((p) => defaults.includes(p.name)).map((p) => p.name));
    });
    engine.ready.then(() => setEngineReady(true));
    fetch(`${import.meta.env.BASE_URL}examples/index.json`)
      .then((r) => r.json())
      .then((list: Example[]) => setExamples(list))
      .catch(() => {});
    // GitHub Pages caches index.html for ten minutes: a tab opened before a
    // deploy keeps the old build. version.txt is fetched past the cache.
    const checkBuild = () =>
      fetch(`${import.meta.env.BASE_URL}version.txt`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.text() : ''))
        .then((v) => {
          const id = v.trim();
          if (id && id !== __BUILD_ID__) setNewerBuild(id);
        })
        .catch(() => {});
    checkBuild();
    const timer = window.setInterval(checkBuild, 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [engine]);

  // keep the log scrolled to the newest line while running
  useEffect(() => {
    if (logRef.current && isProcessing) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [analysisLog, isProcessing]);

  const loadExample = useCallback(
    async (ex: Example) => {
      setShowExamples(false);
      try {
        const code = ex.inline ?? (await (await fetch(`${import.meta.env.BASE_URL}examples/${ex.file}`)).text());
        setInputCode(code);
        notify('ok', `Loaded: ${ex.name}`);
      } catch {
        notify('error', 'Could not load the example');
      }
    },
    [notify]
  );

  const handleDeobfuscate = useCallback(async () => {
    if (!inputCode.trim()) {
      notify('error', 'Paste some JavaScript first');
      return;
    }
    if (engine.busy) return;
    setIsProcessing(true);
    setAnalysisLog([]);
    setDiagnostics([]);
    setOutputCode('');
    setParsedAST(null);
    setMetrics(null);
    setShowConsole(true);
    setConsoleTab('log');
    const started = performance.now();
    try {
      const done = await engine.run(
        { code: inputCode, passes: selectedPasses, lenientMode, autoFix },
        (entry) => setAnalysisLog((prev) => [...prev, entry])
      );
      setOutputCode(done.deobfuscatedCode);
      setAnalysisLog(done.entries);
      setParsedAST(done.ast);
      setMetrics({
        orig: inputCode.length,
        final: done.deobfuscatedCode.length,
        reduction: String(done.metadata?.reductionPercent ?? '0'),
      });
      const problems: Diagnostic[] = [
        ...done.structuredParseErrors.map((e): Diagnostic => ({ severity: 'error', source: 'input', ...e })),
        ...done.structuredParseWarnings.map((e): Diagnostic => ({ severity: 'warning', source: 'input', ...e })),
        ...done.outputErrors.map((e): Diagnostic => ({ severity: 'error', source: 'output', ...e })),
        ...done.errors.map((message): Diagnostic => ({ severity: 'error', source: 'engine', message })),
      ];
      setDiagnostics(problems);
      const errors = problems.filter((p) => p.severity === 'error').length;
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      if (errors > 0) {
        setConsoleTab('errors');
        notify('warn', `Done with ${errors} error${errors > 1 ? 's' : ''} — see the Errors tab`);
      } else if (problems.length > 0) notify('ok', `Done in ${seconds}s — ${problems.length} warning${problems.length > 1 ? 's' : ''}`);
      else notify('ok', `Deobfuscation complete in ${seconds}s`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== 'stopped') {
        notify('error', msg.length > 90 ? msg.slice(0, 90) + '…' : msg);
        setDiagnostics([{ severity: 'error', source: 'engine', message: msg }]);
        setConsoleTab('errors');
      } else {
        setAnalysisLog((prev) => [...prev, { kind: 'warn', text: 'stopped', depth: 0 }]);
      }
    } finally {
      setIsProcessing(false);
    }
  }, [autoFix, engine, inputCode, lenientMode, notify, selectedPasses]);

  const handleStop = useCallback(() => {
    engine.stop();
    setEngineReady(false);
    engine.ready.then(() => setEngineReady(true));
  }, [engine]);

  // `#example=<id>&run` preloads an example; `&run` starts it (used by the smoke test)
  const autoRun = useRef(false);
  useEffect(() => {
    if (!examples.length) return;
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const packed = params.get('code');
    if (packed) {
      try {
        setInputCode(decodeCode(packed));
        autoRun.current = params.has('run');
      } catch {
        notify('error', 'The link carries no readable code');
      }
      return;
    }
    const id = params.get('example');
    const ex = id ? examples.find((e) => e.id === id) : null;
    if (!ex) return;
    autoRun.current = params.has('run');
    loadExample(ex);
  }, [examples, loadExample, notify]);

  const handleShareLink = async () => {
    if (!inputCode.trim()) {
      notify('error', 'Nothing to share yet');
      return;
    }
    const packed = encodeCode(inputCode);
    if (packed.length > 60_000) {
      notify('warn', 'Input too large for a link (about 45 KB max)');
      return;
    }
    const url = `${window.location.origin}${window.location.pathname}#code=${packed}&run`;
    await navigator.clipboard.writeText(url);
    notify('ok', 'Link with this input copied — it runs on open');
  };
  useEffect(() => {
    if (autoRun.current && engineReady && inputCode && !isProcessing && !outputCode) {
      autoRun.current = false;
      handleDeobfuscate();
    }
  }, [engineReady, handleDeobfuscate, inputCode, isProcessing, outputCode]);

  const jumpToDiagnostic = useCallback((d: Diagnostic) => {
    const editor = d.source === 'output' ? outputEditorRef.current : inputEditorRef.current;
    if (!editor || d.line === undefined) return;
    if (d.endLine !== undefined) editor.selectLines(d.line, d.col ?? 0, d.endLine, d.endCol ?? 0);
    else editor.jumpTo(d.line, d.col ?? 0);
  }, []);

  const handleAstSelect = useCallback((_node: AnyNode, range: NodeRange | null) => {
    if (range) outputEditorRef.current?.selectRange(range.start, range.end);
  }, []);

  const handleDownload = () => {
    if (!outputCode) return;
    const blob = new Blob([outputCode], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'deobfuscated.js';
    a.click();
    URL.revokeObjectURL(url);
    notify('ok', 'Downloaded');
  };

  const handleCopyOutput = async () => {
    if (!outputCode) return;
    await navigator.clipboard.writeText(outputCode);
    notify('ok', 'Copied to clipboard');
  };

  const handleClear = () => {
    setInputCode('');
    setOutputCode('');
    setAnalysisLog([]);
    setDiagnostics([]);
    setParsedAST(null);
    setMetrics(null);
  };

  const togglePass = (name: string) => setSelectedPasses((p) => (p.includes(name) ? p.filter((n) => n !== name) : [...p, name]));
  const selectAllPasses = () => setSelectedPasses(allSteps.map((p) => p.name));
  const selectDefaultPasses = () => setSelectedPasses(allSteps.filter((p) => defaults.includes(p.name)).map((p) => p.name));
  const deselectAllPasses = () => setSelectedPasses([]);

  const editorDiagnostics = (source: 'input' | 'output'): EditorDiagnostic[] =>
    diagnostics
      .filter((d) => d.source === source && d.line !== undefined)
      .map((d) => ({ line: d.line!, col: d.col, message: d.message, severity: d.severity }));

  const sideToggle = (onClick: () => void, title: string, Icon: typeof Settings, side: 'left' | 'right') => (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 28,
        flexShrink: 0,
        border: 'none',
        [side === 'left' ? 'borderRight' : 'borderLeft']: `1px solid ${C.surface0}`,
        backgroundColor: C.mantle,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon size={14} style={{ color: C.overlay0 }} />
    </button>
  );

  const tabStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 600,
    color: active ? C.text : C.subtext0,
    background: 'none',
    border: 'none',
    borderBottom: `2px solid ${active ? C.blue : 'transparent'}`,
    cursor: 'pointer',
    marginBottom: -1,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: C.base, overflow: 'hidden' }}>
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header style={{ flexShrink: 0, backgroundColor: C.mantle, borderBottom: `1px solid ${C.surface0}`, padding: '0 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 52 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                backgroundColor: C.surface0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: `1px solid ${C.surface1}`,
              }}
            >
              <Zap size={16} style={{ color: C.blue }} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text, letterSpacing: '-0.01em', lineHeight: 1 }}>JS Deobfuscator</div>
              <div style={{ fontSize: 11, color: C.overlay0, lineHeight: 1, marginTop: 2 }}>
                js-defuser · runs entirely in your browser · <span title="build" className="font-mono">{__BUILD_ID__}</span>
                {!engineReady && <span style={{ color: C.peach }}> · loading sandbox…</span>}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isProcessing ? (
              <button onClick={handleStop} style={headerButton({ color: C.red })} title="Stop the current run">
                <Square size={13} /> Stop
              </button>
            ) : (
              <button onClick={handleDeobfuscate} disabled={!engineReady} style={headerButton({ primary: true, disabled: !engineReady })}>
                <Play size={14} />
                Deobfuscate
              </button>
            )}

            <div style={{ position: 'relative' }}>
              <button onClick={() => setShowExamples((s) => !s)} style={headerButton({ color: C.mauve })} title="Load an example input">
                <FlaskConical size={14} /> Examples
              </button>
              {showExamples && (
                <div
                  style={{
                    position: 'absolute',
                    top: 40,
                    right: 0,
                    width: 360,
                    zIndex: 40,
                    backgroundColor: C.surface0,
                    border: `1px solid ${C.surface1}`,
                    borderRadius: 8,
                    boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
                    overflow: 'hidden',
                  }}
                >
                  {examples.map((ex) => (
                    <button
                      key={ex.id}
                      onClick={() => loadExample(ex)}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '9px 12px',
                        background: 'none',
                        border: 'none',
                        borderBottom: `1px solid ${C.surface1}`,
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{ex.name}</div>
                      <div style={{ fontSize: 11, color: C.overlay0, marginTop: 2, lineHeight: 1.4 }}>{ex.description}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div style={{ width: 1, height: 20, backgroundColor: C.surface1 }} />

            <button onClick={handleShareLink} disabled={!inputCode} title="Copy a link that carries this input" style={headerButton({ disabled: !inputCode })}>
              <Link size={14} /> Share link
            </button>
            <button onClick={handleDownload} disabled={!outputCode} title="Download" style={headerButton({ disabled: !outputCode })}>
              <Download size={14} /> Download
            </button>
            <button onClick={handleCopyOutput} disabled={!outputCode} title="Copy output" style={headerButton({ disabled: !outputCode })}>
              <Copy size={14} />
            </button>
            <button onClick={handleClear} title="Clear" style={headerButton()}>
              <RotateCcw size={14} />
            </button>

            <div style={{ width: 1, height: 20, backgroundColor: C.surface1 }} />

            <a href="https://github.com/Arsylk/js-defuser" target="_blank" rel="noreferrer" style={headerButton()} title="Engine, CLI and tests on GitHub">
              <Braces size={14} /> js-defuser
            </a>
          </div>
        </div>
      </header>

      {/* ── Main workspace ───────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {/* ── Left: Passes panel ─────────────────────────────────────────── */}
        {showPasses ? (
          <div
            style={{
              width: 300,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              borderRight: `1px solid ${C.surface0}`,
              backgroundColor: C.mantle,
              overflow: 'hidden',
            }}
            data-testid="passes"
          >
            <div
              style={{
                padding: '12px 14px 10px',
                borderBottom: `1px solid ${C.surface0}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Settings size={14} style={{ color: C.blue }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>Passes</span>
                <span style={{ fontSize: 11, color: C.overlay0, backgroundColor: C.surface0, padding: '1px 6px', borderRadius: 4 }}>
                  {selectedPasses.length}/{allSteps.length}
                </span>
              </div>
              <button onClick={() => setShowPasses(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
                <X size={13} style={{ color: C.overlay0 }} />
              </button>
            </div>

            <div style={{ padding: '8px 10px 4px', display: 'flex', gap: 6 }}>
              <button onClick={selectDefaultPasses} style={smallButton}>
                Defaults
              </button>
              <button onClick={selectAllPasses} style={smallButton}>
                All
              </button>
              <button onClick={deselectAllPasses} style={smallButton}>
                None
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 10px 10px' }}>
              {pipeline.map((stage) => {
                const on = stage.steps.filter((s) => selectedPasses.includes(s.name)).length;
                return (
                  <section key={stage.id} style={{ marginTop: 10 }}>
                    <div style={{ padding: '0 2px 6px' }}>
                      <div className="flex items-center gap-2">
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.subtext0 }}>
                          stage {stage.id} · {stage.title}
                        </span>
                        <span style={{ fontSize: 10, color: C.overlay0, marginLeft: 'auto' }}>
                          {on}/{stage.steps.length}
                        </span>
                      </div>
                      <p style={{ fontSize: 11, color: C.overlay0, lineHeight: 1.4, marginTop: 2 }}>{stage.summary}</p>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {stage.steps.map((step) => (
                        <PassRow key={step.name} step={step} enabled={selectedPasses.includes(step.name)} onToggle={() => togglePass(step.name)} />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>

            <div style={{ padding: '10px 14px', borderTop: `1px solid ${C.surface0}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Toggle on={lenientMode} onChange={() => setLenientMode((l) => !l)} label="Lenient mode" />
              <Toggle on={autoFix} onChange={() => setAutoFix((a) => !a)} label="Auto-fix parse errors" />
            </div>
          </div>
        ) : (
          sideToggle(() => setShowPasses(true), 'Show passes', Settings, 'left')
        )}

        {/* ── Center: Editors ─────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          <div style={{ flexShrink: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: `1px solid ${C.surface0}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px', height: 36, borderRight: `1px solid ${C.surface0}`, backgroundColor: C.mantle }}>
              <FileCode size={13} style={{ color: C.red }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>Input — Obfuscated</span>
              <span style={{ fontSize: 11, color: C.overlay0, marginLeft: 'auto' }}>{byteFmt(inputCode.length)}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px', height: 36, backgroundColor: C.mantle }}>
              <FileCode size={13} style={{ color: C.green }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>Output — Deobfuscated</span>
              {metrics && (
                <span style={{ fontSize: 11, color: C.overlay0, marginLeft: 'auto' }}>
                  {byteFmt(metrics.final)}
                  <span style={{ color: Number(metrics.reduction) > 0 ? C.green : C.overlay0, marginLeft: 4 }}>
                    {Number(metrics.reduction) > 0 ? `−${metrics.reduction}%` : ''}
                  </span>
                </span>
              )}
            </div>
          </div>

          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', overflow: 'hidden', minHeight: 0 }}>
            <div style={{ borderRight: `1px solid ${C.surface0}`, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <CodeMirrorEditor value={inputCode} onChange={setInputCode} style={{ flex: 1 }} ref={inputEditorRef} diagnostics={editorDiagnostics('input')} />
            </div>
            <div style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }} data-testid="output">
              <CodeMirrorEditor value={outputCode || ''} onChange={() => {}} readOnly style={{ flex: 1 }} ref={outputEditorRef} diagnostics={editorDiagnostics('output')} />
            </div>
          </div>
        </div>

        {/* ── Right: AST Explorer ─────────────────────────────────────────── */}
        {showAST ? (
          <div
            style={{
              width: 320,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              borderLeft: `1px solid ${C.surface0}`,
              backgroundColor: C.mantle,
              overflow: 'hidden',
            }}
            data-testid="ast"
          >
            <div
              style={{
                padding: '10px 14px',
                borderBottom: `1px solid ${C.surface0}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Layers size={14} style={{ color: C.mauve }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>AST Explorer</span>
                <span style={{ fontSize: 11, color: C.overlay0 }}>output</span>
              </div>
              <button onClick={() => setShowAST(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
                <X size={13} style={{ color: C.overlay0 }} />
              </button>
            </div>
            <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
              <ASTExplorer ast={parsedAST} onSelect={handleAstSelect} />
            </div>
          </div>
        ) : (
          sideToggle(() => setShowAST(true), 'Show AST', Layers, 'right')
        )}
      </div>

      {/* ── Bottom: console (Analysis Log | Errors) ──────────────────────── */}
      <div style={{ flexShrink: 0, borderTop: `1px solid ${C.surface0}`, backgroundColor: C.mantle, display: 'flex', flexDirection: 'column' }} data-testid="console">
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 10px', borderBottom: showConsole ? `1px solid ${C.surface0}` : 'none' }}>
          <button onClick={() => { setConsoleTab('log'); setShowConsole(true); }} style={tabStyle(consoleTab === 'log' && showConsole)} data-testid="tab-log">
            <BookOpen size={13} style={{ color: C.sapphire }} />
            Analysis Log
            {analysisLog.length > 0 && <span style={chip(C.overlay0)}>{analysisLog.length}</span>}
          </button>
          <button onClick={() => { setConsoleTab('errors'); setShowConsole(true); }} style={tabStyle(consoleTab === 'errors' && showConsole)} data-testid="tab-errors">
            <AlertCircle size={13} style={{ color: errorCount ? C.red : warningCount ? C.yellow : C.overlay0 }} />
            Errors
            {errorCount > 0 && <span style={chip(C.base, C.red)}>{errorCount}</span>}
            {warningCount > 0 && <span style={chip(C.base, C.yellow)}>{warningCount}</span>}
          </button>
          {isProcessing && (
            <span style={{ fontSize: 11, color: C.peach, display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: C.peach, display: 'inline-block', animation: 'pulse 1s infinite' }} />
              Running…
            </span>
          )}
          <button onClick={() => setShowConsole((s) => !s)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }} title={showConsole ? 'Collapse' : 'Expand'}>
            {showConsole ? <ChevronDown size={13} style={{ color: C.overlay0 }} /> : <ChevronUp size={13} style={{ color: C.overlay0 }} />}
          </button>
        </div>

        {showConsole && consoleTab === 'log' && (
          <div ref={logRef} style={{ height: consoleHeight, overflowY: 'auto', padding: '8px 16px' }} data-testid="log">
            {analysisLog.length === 0 ? (
              <p style={{ fontSize: 12, color: C.overlay0, fontStyle: 'italic' }}>Paste code (or pick an example) and click Deobfuscate to begin…</p>
            ) : (
              analysisLog.map((entry, i) => <LogLine key={i} entry={entry} />)
            )}
          </div>
        )}
        {showConsole && consoleTab === 'errors' && (
          <div style={{ height: consoleHeight, overflowY: 'auto', padding: '6px 16px' }} data-testid="errors">
            {diagnostics.length === 0 ? (
              <p style={{ fontSize: 12, color: C.overlay0, fontStyle: 'italic', paddingTop: 2 }}>
                {outputCode ? 'No problems — the input parsed cleanly and every pass finished.' : 'Problems from the parse and the passes will be listed here with their position.'}
              </p>
            ) : (
              diagnostics.map((d, i) => <DiagnosticRow key={i} d={d} onJump={jumpToDiagnostic} />)
            )}
          </div>
        )}
      </div>

      {newerBuild && (
        <div
          style={{
            position: 'fixed',
            top: 60,
            right: 24,
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 12px',
            borderRadius: 8,
            fontSize: 12,
            backgroundColor: C.surface0,
            color: C.text,
            border: `1px solid ${C.blue}66`,
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          }}
        >
          <span>
            A newer build is live (<span className="font-mono">{newerBuild}</span>); this tab still runs <span className="font-mono">{__BUILD_ID__}</span>.
          </span>
          <button onClick={() => window.location.reload()} style={{ ...headerButton({ primary: true }), padding: '4px 10px', fontSize: 12 }}>
            Reload
          </button>
          <button onClick={() => setNewerBuild(null)} title="Dismiss" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
            <X size={13} style={{ color: C.overlay0 }} />
          </button>
        </div>
      )}
      {toast && <div style={toastStyle(toast.kind)}>{toast.text}</div>}
    </div>
  );
}
