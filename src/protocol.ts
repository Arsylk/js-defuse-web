import type { Entry } from 'js-defuser/logger';

export interface PassInfo {
  id: string;
  name: string;
  description: string;
  enabled_by_default: boolean;
  pass_order: number;
}

export interface ParseError {
  message: string;
  line?: number;
  col?: number;
}

export interface JobMessage {
  type: 'run';
  code: string;
  passes: string[];
  lenientMode: boolean;
  autoFix: boolean;
}

export interface DoneMessage {
  type: 'done';
  deobfuscatedCode: string;
  entries: Entry[];
  success: boolean;
  errors: string[];
  structuredParseErrors: ParseError[];
  structuredParseWarnings: ParseError[];
  metadata: Record<string, unknown>;
  ast: unknown;
}

export type WorkerMessage =
  | { type: 'catalog'; passes: PassInfo[]; defaults: string[] }
  | { type: 'ready' }
  | { type: 'log'; entry: Entry }
  | DoneMessage
  | { type: 'error'; message: string };
