// The engine runs here, off the page: a large input keeps it busy for minutes
// and it is synchronous while it works. The page sends one job at a time and
// gets every log entry back as it is produced, then the result (with the
// output parsed for the AST explorer).
import { parse } from '@babel/parser';
import { DEFAULT_ENABLED_PASSES, PASS_CATALOG, deobfuscate, prepare } from 'js-defuser/browser';
import type { Entry } from 'js-defuser/logger';
import type { DoneMessage, JobMessage, WorkerMessage } from './protocol';

const post = (m: WorkerMessage) => self.postMessage(m);

post({ type: 'catalog', passes: PASS_CATALOG, defaults: [...DEFAULT_ENABLED_PASSES] });
prepare().then(
  () => post({ type: 'ready' }),
  (e: unknown) => post({ type: 'error', message: `sandbox failed to load: ${e instanceof Error ? e.message : String(e)}` })
);

self.onmessage = async (ev: MessageEvent<JobMessage>) => {
  const job = ev.data;
  if (job.type !== 'run') return;
  try {
    const result = await deobfuscate(job.code, {
      enabledPasses: job.passes,
      lenientMode: job.lenientMode,
      autoFix: job.autoFix,
      onLog: (_line: string, entry: Entry) => post({ type: 'log', entry }),
    });
    let ast: unknown = null;
    try {
      ast = parse(result.deobfuscatedCode, {
        sourceType: 'unambiguous',
        plugins: ['jsx'],
        errorRecovery: true,
        allowReturnOutsideFunction: true,
      }).program;
    } catch {
      ast = null;
    }
    const done: DoneMessage = {
      type: 'done',
      deobfuscatedCode: result.deobfuscatedCode,
      entries: result.entries,
      success: result.success,
      errors: result.errors,
      structuredParseErrors: result.structuredParseErrors,
      structuredParseWarnings: result.structuredParseWarnings,
      metadata: result.metadata,
      ast,
    };
    post(done);
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
