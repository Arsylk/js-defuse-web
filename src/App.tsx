import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  FileCode,
  FlaskConical,
  Braces,
  Layers,
  Play,
  RotateCcw,
  Settings,
  Square,
  X,
  Zap,
} from 'lucide-react';
import { mocha, segments, tones, type Entry } from 'js-defuser/logger';
import CodeMirrorEditor, { type EditorHandle } from './components/CodeMirrorEditor';
import ASTExplorer from './components/ASTExplorer';
import { EngineClient } from './engine-client';
import type { ParseError, PassInfo } from './protocol';

// ── Catppuccin Mocha — one palette for the ui and the logger ─────────────────
const C = mocha;

interface Example {
  id: string;
  name: string;
  description: string;
  file?: string;
  inline?: string;
}

// ── helpers ───────────────────────────────────────────────────────────────────
function byteFmt(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
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

// ── Pass toggle ───────────────────────────────────────────────────────────────
function PassToggle({ pass, enabled, onToggle }: { pass: PassInfo; enabled: boolean; onToggle: () => void }) {
  return (
    <label
      className="flex items-start gap-2.5 p-2.5 rounded-lg cursor-pointer transition-all"
      style={{
        backgroundColor: enabled ? `${C.surface0}` : 'transparent',
        border: `1px solid ${enabled ? C.surface1 : 'transparent'}`,
      }}
      onClick={onToggle}
    >
      <div
        className="mt-0.5 w-4 h-4 rounded flex items-center justify-center flex-shrink-0 cursor-pointer transition-all"
        style={{
          backgroundColor: enabled ? C.blue : C.surface1,
          border: `1px solid ${enabled ? C.blue : C.surface2}`,
        }}
      >
        {enabled && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path d="M1 4l3 3 5-6" stroke={C.base} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold font-mono leading-tight" style={{ color: enabled ? C.text : C.subtext0 }}>
          {pass.name}
        </p>
        <p className="text-xs mt-0.5 leading-snug" style={{ color: C.overlay0 }}>
          {pass.description}
        </p>
      </div>
    </label>
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

// ── main ──────────────────────────────────────────────────────────────────────
export default function App() {
  const engine = useMemo(() => new EngineClient(), []);
  const [engineReady, setEngineReady] = useState(false);
  const [inputCode, setInputCode] = useState('');
  const [outputCode, setOutputCode] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [passes, setPasses] = useState<PassInfo[]>([]);
  const [selectedPasses, setSelectedPasses] = useState<string[]>([]);
  const [analysisLog, setAnalysisLog] = useState<Entry[]>([]);
  const [lenientMode, setLenientMode] = useState(false);
  const [autoFix, setAutoFix] = useState(true);
  const [parsedAST, setParsedAST] = useState<unknown>(null);
  const [structuredParseErrors, setStructuredParseErrors] = useState<ParseError[]>([]);
  const [structuredParseWarnings, setStructuredParseWarnings] = useState<ParseError[]>([]);
  const [examples, setExamples] = useState<Example[]>([]);
  const [showExamples, setShowExamples] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const inputEditorRef = useRef<EditorHandle>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number | null>(null);

  // panel visibility
  const [showPasses, setShowPasses] = useState(true);
  const [showAST, setShowAST] = useState(true);
  const [showLog, setShowLog] = useState(true);
  const logHeight = 200;

  // metrics
  const [metrics, setMetrics] = useState<{ orig: number; final: number; reduction: string } | null>(null);

  const notify = useCallback((kind: 'ok' | 'warn' | 'error', text: string) => {
    setToast({ kind, text });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    engine.getCatalog().then(({ passes, defaults }) => {
      const sorted = [...passes].sort((a, b) => a.pass_order - b.pass_order);
      setPasses(sorted);
      setSelectedPasses(sorted.filter((p) => defaults.includes(p.name)).map((p) => p.name));
    });
    engine.ready.then(() => setEngineReady(true));
    fetch(`${import.meta.env.BASE_URL}examples/index.json`)
      .then((r) => r.json())
      .then((list: Example[]) => setExamples(list))
      .catch(() => {});
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
    setOutputCode('');
    setParsedAST(null);
    setMetrics(null);
    setStructuredParseErrors([]);
    setStructuredParseWarnings([]);
    setShowLog(true);
    const started = performance.now();
    try {
      const done = await engine.run(
        { code: inputCode, passes: selectedPasses, lenientMode, autoFix },
        (entry) => setAnalysisLog((prev) => [...prev, entry])
      );
      setOutputCode(done.deobfuscatedCode);
      setAnalysisLog(done.entries);
      setParsedAST(done.ast);
      setStructuredParseErrors(done.structuredParseErrors || []);
      setStructuredParseWarnings(done.structuredParseWarnings || []);
      setMetrics({
        orig: inputCode.length,
        final: done.deobfuscatedCode.length,
        reduction: String(done.metadata?.reductionPercent ?? '0'),
      });
      const errCount = (done.structuredParseErrors || []).length;
      const warnCount = (done.structuredParseWarnings || []).length;
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      const summaryLines: Entry[] = [];
      const at = (e: ParseError) => (e.line ? `${e.line}:${e.col ?? 0}` : undefined);
      if (errCount > 0) {
        summaryLines.push({ kind: 'error', text: `${errCount} parse error${errCount > 1 ? 's' : ''}`, detail: 'click the banner to jump to the location', depth: 0 });
        for (const e of done.structuredParseErrors) summaryLines.push({ kind: 'note', text: e.message.split('\n')[0], detail: at(e), depth: 0 });
      }
      if (warnCount > 0) summaryLines.push({ kind: 'warn', text: `${warnCount} browser-tolerant warning${warnCount > 1 ? 's' : ''}`, detail: 'non-breaking', depth: 0 });
      for (const e of done.errors) summaryLines.push({ kind: 'error', text: e, depth: 0 });
      if (summaryLines.length > 0) setAnalysisLog((prev) => [...prev, ...summaryLines]);
      if (errCount > 0) notify('warn', `${errCount} parse error${errCount > 1 ? 's' : ''} — see log`);
      else if (!done.success) notify('warn', `Done with ${done.errors.length} pass error${done.errors.length > 1 ? 's' : ''} — see log`);
      else notify('ok', `Deobfuscation complete in ${seconds}s`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== 'stopped') {
        notify('error', msg.length > 90 ? msg.slice(0, 90) + '…' : msg);
        setAnalysisLog((prev) => [...prev, { kind: 'error', text: msg, depth: 0 }]);
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

  // `#example=<id>` preloads an example; `&run` starts it (used by the smoke test)
  const autoRun = useRef(false);
  useEffect(() => {
    if (!examples.length) return;
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const id = params.get('example');
    const ex = id ? examples.find((e) => e.id === id) : null;
    if (!ex) return;
    autoRun.current = params.has('run');
    loadExample(ex);
  }, [examples, loadExample]);
  useEffect(() => {
    if (autoRun.current && engineReady && inputCode && !isProcessing && !outputCode) {
      autoRun.current = false;
      handleDeobfuscate();
    }
  }, [engineReady, handleDeobfuscate, inputCode, isProcessing, outputCode]);

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
    setStructuredParseErrors([]);
    setStructuredParseWarnings([]);
    setParsedAST(null);
    setMetrics(null);
  };

  const togglePass = (name: string) => setSelectedPasses((p) => (p.includes(name) ? p.filter((n) => n !== name) : [...p, name]));
  const selectAllPasses = () => setSelectedPasses(passes.map((p) => p.name));
  const deselectAllPasses = () => setSelectedPasses([]);

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: C.base, overflow: 'hidden' }}>
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header style={{ flexShrink: 0, backgroundColor: C.mantle, borderBottom: `1px solid ${C.surface0}`, padding: '0 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 52 }}>
          {/* Logo */}
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
                js-defuser · runs entirely in your browser
                {!engineReady && <span style={{ color: C.peach }}> · loading sandbox…</span>}
              </div>
            </div>
          </div>

          {/* Actions */}
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

            {/* Examples */}
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
              width: 270,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              borderRight: `1px solid ${C.surface0}`,
              backgroundColor: C.mantle,
              overflow: 'hidden',
            }}
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
                  {selectedPasses.length}/{passes.length}
                </span>
              </div>
              <button onClick={() => setShowPasses(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
                <X size={13} style={{ color: C.overlay0 }} />
              </button>
            </div>

            <div style={{ padding: '8px 10px 4px', display: 'flex', gap: 6 }}>
              {[
                ['All', selectAllPasses],
                ['None', deselectAllPasses],
              ].map(([label, fn]) => (
                <button
                  key={label as string}
                  onClick={fn as () => void}
                  style={{
                    flex: 1,
                    fontSize: 11,
                    padding: '4px 0',
                    borderRadius: 5,
                    border: `1px solid ${C.surface1}`,
                    backgroundColor: 'transparent',
                    color: C.subtext0,
                    cursor: 'pointer',
                  }}
                >
                  {label as string}
                </button>
              ))}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '6px 10px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {passes.map((p) => (
                  <PassToggle key={p.id} pass={p} enabled={selectedPasses.includes(p.name)} onToggle={() => togglePass(p.name)} />
                ))}
              </div>
            </div>

            {/* Options */}
            <div style={{ padding: '10px 14px', borderTop: `1px solid ${C.surface0}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Toggle on={lenientMode} onChange={() => setLenientMode((l) => !l)} label="Lenient mode" />
              <Toggle on={autoFix} onChange={() => setAutoFix((a) => !a)} label="Auto-fix errors" />
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

          {/* Parse warnings banner */}
          {structuredParseWarnings.length > 0 && (
            <div
              style={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '0 12px',
                height: 30,
                overflow: 'hidden',
                backgroundColor: `${C.yellow}12`,
                borderBottom: `1px solid ${C.yellow}33`,
              }}
            >
              <AlertCircle size={12} style={{ color: C.yellow, flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: C.yellow, flexShrink: 0 }}>
                {structuredParseWarnings.length} warning{structuredParseWarnings.length > 1 ? 's' : ''} (non-breaking)
              </span>
              <button
                onClick={() => {
                  const w = structuredParseWarnings[0];
                  if (w.line) inputEditorRef.current?.jumpTo(w.line, w.col ?? 0);
                }}
                style={{
                  fontSize: 11,
                  color: C.subtext0,
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: structuredParseWarnings[0].line ? 'pointer' : 'default',
                  fontFamily: 'ui-monospace, monospace',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                  textAlign: 'left',
                  minWidth: 0,
                }}
              >
                — {structuredParseWarnings[0].message.split('\n')[0].slice(0, 70)}
                {structuredParseWarnings.length > 1 ? ` +${structuredParseWarnings.length - 1} more` : ''}
              </button>
              <span style={{ fontSize: 11, color: C.overlay0, flexShrink: 0 }}>see log ↓</span>
            </div>
          )}

          {/* Parse errors banner */}
          {structuredParseErrors.length > 0 && (
            <div
              style={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '0 12px',
                height: 30,
                overflow: 'hidden',
                backgroundColor: `${C.red}18`,
                borderBottom: `1px solid ${C.red}44`,
              }}
            >
              <AlertCircle size={12} style={{ color: C.red, flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: C.red, flexShrink: 0 }}>
                {structuredParseErrors.length} error{structuredParseErrors.length > 1 ? 's' : ''}
              </span>
              <button
                onClick={() => {
                  const e = structuredParseErrors[0];
                  if (e.line) inputEditorRef.current?.jumpTo(e.line, e.col ?? 0);
                }}
                style={{
                  fontSize: 11,
                  color: structuredParseErrors[0].line ? C.red : C.subtext0,
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: structuredParseErrors[0].line ? 'pointer' : 'default',
                  textDecoration: structuredParseErrors[0].line ? 'underline dotted' : 'none',
                  fontFamily: 'ui-monospace, monospace',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                  textAlign: 'left',
                  minWidth: 0,
                }}
              >
                {structuredParseErrors[0].line ? `[${structuredParseErrors[0].line}:${structuredParseErrors[0].col ?? 0}] ` : ''}
                {structuredParseErrors[0].message.split('\n')[0].slice(0, 60)}
                {structuredParseErrors.length > 1 ? ` +${structuredParseErrors.length - 1} more — see log` : ' — see log'}
              </button>
            </div>
          )}

          {/* Dual editors */}
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', overflow: 'hidden', minHeight: 0 }}>
            <div style={{ borderRight: `1px solid ${C.surface0}`, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <CodeMirrorEditor
                value={inputCode}
                onChange={setInputCode}
                style={{ flex: 1 }}
                ref={inputEditorRef}
                diagnostics={[
                  ...structuredParseErrors
                    .filter((e) => e.line !== undefined)
                    .map((e) => ({ line: e.line!, col: e.col, message: e.message, severity: 'error' as const })),
                  ...structuredParseWarnings
                    .filter((w) => w.line !== undefined)
                    .map((w) => ({ line: w.line!, col: w.col, message: w.message, severity: 'warning' as const })),
                ]}
              />
            </div>
            <div style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }} data-testid="output">
              <CodeMirrorEditor value={outputCode || ''} onChange={() => {}} readOnly style={{ flex: 1 }} />
            </div>
          </div>
        </div>

        {/* ── Right: AST Explorer ─────────────────────────────────────────── */}
        {showAST ? (
          <div
            style={{
              width: 300,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              borderLeft: `1px solid ${C.surface0}`,
              backgroundColor: C.mantle,
              overflow: 'hidden',
            }}
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
              </div>
              <button onClick={() => setShowAST(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
                <X size={13} style={{ color: C.overlay0 }} />
              </button>
            </div>
            <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
              <ASTExplorer ast={parsedAST} />
            </div>
          </div>
        ) : (
          sideToggle(() => setShowAST(true), 'Show AST', Layers, 'right')
        )}
      </div>

      {/* ── Bottom: Analysis Log ─────────────────────────────────────────── */}
      <div style={{ flexShrink: 0, borderTop: `1px solid ${C.surface0}`, backgroundColor: C.mantle, display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 16px',
            cursor: 'pointer',
            userSelect: 'none',
            borderBottom: showLog ? `1px solid ${C.surface0}` : 'none',
          }}
          onClick={() => setShowLog((l) => !l)}
        >
          <BookOpen size={13} style={{ color: C.sapphire }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>Analysis Log</span>
          {analysisLog.length > 0 && (
            <span style={{ fontSize: 11, color: C.overlay0, backgroundColor: C.surface0, padding: '1px 6px', borderRadius: 4 }}>{analysisLog.length} lines</span>
          )}
          {isProcessing && (
            <span style={{ fontSize: 11, color: C.peach, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: C.peach, display: 'inline-block', animation: 'pulse 1s infinite' }} />
              Running…
            </span>
          )}
          <span style={{ marginLeft: 'auto' }}>{showLog ? <ChevronUp size={13} style={{ color: C.overlay0 }} /> : <ChevronDown size={13} style={{ color: C.overlay0 }} />}</span>
        </div>

        {showLog && (
          <div ref={logRef} style={{ height: logHeight, overflowY: 'auto', padding: '8px 16px', fontFamily: 'monospace' }} data-testid="log">
            {analysisLog.length === 0 ? (
              <p style={{ fontSize: 12, color: C.overlay0, fontStyle: 'italic' }}>Paste code (or pick an example) and click Deobfuscate to begin…</p>
            ) : (
              analysisLog.map((entry, i) => <LogLine key={i} entry={entry} />)
            )}
          </div>
        )}
      </div>

      {toast && <div style={toastStyle(toast.kind)}>{toast.text}</div>}
    </div>
  );
}
