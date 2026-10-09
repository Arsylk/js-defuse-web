import { useState, useCallback, useEffect } from 'react';
import { ChevronRight, ChevronDown, Crosshair, Locate } from 'lucide-react';
import { mocha } from 'js-defuser/logger';

// ── node-type colours (Catppuccin Mocha) ─────────────────────────────────────
const NODE_COLORS: Record<string, string> = {
  Program: mocha.blue,
  FunctionDeclaration: mocha.mauve,
  FunctionExpression: mocha.mauve,
  ArrowFunctionExpression: mocha.mauve,
  CallExpression: mocha.sky,
  MemberExpression: mocha.sky,
  BinaryExpression: mocha.peach,
  UnaryExpression: mocha.peach,
  LogicalExpression: mocha.peach,
  ConditionalExpression: mocha.peach,
  AssignmentExpression: mocha.red,
  Identifier: mocha.text,
  StringLiteral: mocha.green,
  NumericLiteral: mocha.peach,
  BooleanLiteral: mocha.peach,
  NullLiteral: mocha.overlay0,
  TemplateLiteral: mocha.teal,
  VariableDeclaration: mocha.yellow,
  VariableDeclarator: mocha.yellow,
  IfStatement: mocha.mauve,
  ReturnStatement: mocha.red,
  BlockStatement: mocha.surface1,
  ExpressionStatement: mocha.subtext0,
  ArrayExpression: mocha.sky,
  ObjectExpression: mocha.sky,
  ObjectProperty: mocha.sky,
  SwitchStatement: mocha.mauve,
  SwitchCase: mocha.mauve,
  WhileStatement: mocha.mauve,
  ForStatement: mocha.mauve,
};
const nodeColor = (type: string) => NODE_COLORS[type] ?? mocha.overlay0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyNode = any;

export interface NodeRange {
  start: number;
  end: number;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

/** Babel's offsets and 1-based line / 0-based column, when the node carries them. */
export function nodeRange(node: AnyNode): NodeRange | null {
  if (!node || typeof node.start !== 'number' || typeof node.end !== 'number' || !node.loc) return null;
  return {
    start: node.start,
    end: node.end,
    startLine: node.loc.start.line,
    startCol: node.loc.start.column,
    endLine: node.loc.end.line,
    endCol: node.loc.end.column,
  };
}

export const rangeLabel = (r: NodeRange) =>
  r.startLine === r.endLine && r.startCol === r.endCol ? `${r.startLine}:${r.startCol + 1}` : `${r.startLine}:${r.startCol + 1}–${r.endLine}:${r.endCol + 1}`;

// ── inline summary ────────────────────────────────────────────────────────────
function inlineSummary(node: AnyNode): string {
  if (!node || typeof node !== 'object') return '';
  switch (node.type) {
    case 'Identifier':
      return ` ${node.name}`;
    case 'StringLiteral':
      return ` "${(node.value as string).length > 38 ? (node.value as string).slice(0, 38) + '…' : node.value}"`;
    case 'NumericLiteral':
      return ` ${node.value}`;
    case 'BooleanLiteral':
      return ` ${node.value}`;
    case 'NullLiteral':
      return ' null';
    case 'FunctionDeclaration':
    case 'FunctionExpression':
      return node.id ? ` ${node.id.name}()` : ' (anonymous)';
    case 'VariableDeclaration':
      return ` ${node.kind}`;
    case 'CallExpression': {
      const c = node.callee;
      if (c?.type === 'Identifier') return ` ${c.name}(…)`;
      if (c?.type === 'MemberExpression' && c.property?.name) return ` .${c.property.name}(…)`;
      return '';
    }
    default:
      return '';
  }
}

const SKIP_KEYS = new Set(['start', 'end', 'loc', 'extra', 'innerComments', 'leadingComments', 'trailingComments', 'tokens', 'range']);

interface NodeProps {
  node: AnyNode;
  depth: number;
  selectedPath: string;
  onSelect: (node: AnyNode, path: string) => void;
  path: string;
}

function ASTNode({ node, depth, selectedPath, onSelect, path }: NodeProps) {
  const [open, setOpen] = useState(depth < 2);

  if (!node || typeof node !== 'object' || !node.type) return null;

  const isSelected = selectedPath === path;
  const childKeys = Object.keys(node).filter((k) => !SKIP_KEYS.has(k) && k !== 'type');
  const childNodeKeys = childKeys.filter((k) => {
    const v = node[k];
    return v && typeof v === 'object' && (v.type || Array.isArray(v));
  });
  const hasChildren = childNodeKeys.length > 0;
  const indentPx = 8 + depth * 14;

  return (
    <div>
      <div
        className="flex items-center gap-1 cursor-pointer select-none"
        style={{
          paddingLeft: indentPx,
          paddingTop: 2,
          paddingBottom: 2,
          paddingRight: 8,
          backgroundColor: isSelected ? mocha.surface0 : 'transparent',
          borderLeft: isSelected ? `2px solid ${mocha.blue}` : '2px solid transparent',
        }}
        onClick={() => {
          onSelect(node, path);
          if (hasChildren) setOpen((o) => !o);
        }}
      >
        <span style={{ width: 14, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          {hasChildren ? (
            open ? (
              <ChevronDown size={11} style={{ color: mocha.overlay0 }} />
            ) : (
              <ChevronRight size={11} style={{ color: mocha.overlay0 }} />
            )
          ) : null}
        </span>
        <span className="font-mono text-xs font-semibold" style={{ color: nodeColor(node.type), whiteSpace: 'nowrap' }}>
          {node.type}
        </span>
        <span className="font-mono text-xs truncate" style={{ color: mocha.overlay0, maxWidth: 180 }}>
          {inlineSummary(node)}
        </span>
        {isSelected && <Crosshair size={10} style={{ color: mocha.blue, marginLeft: 'auto', flexShrink: 0 }} />}
      </div>

      {open &&
        hasChildren &&
        childNodeKeys.map((key) => {
          const child = node[key];
          const childPath = `${path}.${key}`;
          if (Array.isArray(child)) {
            return (
              <div key={key}>
                <div className="flex items-center gap-1 select-none" style={{ paddingLeft: indentPx + 14, paddingTop: 1, paddingBottom: 1 }}>
                  <span style={{ width: 14 }} />
                  <span className="font-mono text-xs" style={{ color: mocha.surface1 }}>
                    {key}
                  </span>
                  <span className="font-mono text-xs" style={{ color: mocha.surface2 }}>
                    [{child.length}]
                  </span>
                </div>
                {child.map((item: AnyNode, idx: number) =>
                  item && typeof item === 'object' && item.type ? (
                    <ASTNode key={idx} node={item} depth={depth + 2} selectedPath={selectedPath} onSelect={onSelect} path={`${childPath}[${idx}]`} />
                  ) : null
                )}
              </div>
            );
          }
          return <ASTNode key={key} node={child} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} path={childPath} />;
        })}
    </div>
  );
}

interface Props {
  ast: AnyNode | null;
  /** The selected node, with its text range in the output when it has one. */
  onSelect?: (node: AnyNode, range: NodeRange | null) => void;
}

export default function ASTExplorer({ ast, onSelect }: Props) {
  const [selectedNode, setSelectedNode] = useState<AnyNode>(null);
  const [selectedPath, setSelectedPath] = useState('');

  useEffect(() => {
    setSelectedNode(null);
    setSelectedPath('');
  }, [ast]);

  const handleSelect = useCallback(
    (node: AnyNode, path: string) => {
      setSelectedNode(node);
      setSelectedPath(path);
      onSelect?.(node, nodeRange(node));
    },
    [onSelect]
  );

  if (!ast) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3" style={{ color: mocha.overlay0 }}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
        <p className="text-xs text-center leading-relaxed" style={{ color: mocha.surface2 }}>
          Run deobfuscation to
          <br />
          explore the AST
        </p>
      </div>
    );
  }

  const range = selectedNode ? nodeRange(selectedNode) : null;
  const scalars = selectedNode
    ? Object.entries(selectedNode).filter(
        ([k, v]) => !SKIP_KEYS.has(k) && k !== 'type' && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null)
      )
    : [];
  const childrenOf = selectedNode
    ? Object.entries(selectedNode).filter(([k, v]) => !SKIP_KEYS.has(k) && k !== 'type' && v && typeof v === 'object')
    : [];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto py-2 min-h-0" style={{ backgroundColor: mocha.base }}>
        <ASTNode node={ast} depth={0} selectedPath={selectedPath} onSelect={handleSelect} path="root" />
      </div>

      {/* ── inspector ─────────────────────────────────────────────────────── */}
      {selectedNode && (
        <div
          className="flex-shrink-0 flex flex-col"
          style={{ borderTop: `1px solid ${mocha.surface0}`, backgroundColor: mocha.mantle, maxHeight: '45%' }}
        >
          <div
            className="flex items-center gap-2"
            style={{ padding: '10px 14px 8px', borderBottom: `1px solid ${mocha.surface0}` }}
          >
            <span className="text-xs font-bold font-mono" style={{ color: nodeColor(selectedNode.type), flexShrink: 0 }}>
              {selectedNode.type}
            </span>
            {range && (
              <button
                onClick={() => onSelect?.(selectedNode, range)}
                title="Select this node in the output"
                className="flex items-center gap-1 font-mono"
                style={{
                  marginLeft: 'auto',
                  fontSize: 11,
                  color: mocha.blue,
                  background: 'none',
                  border: `1px solid ${mocha.surface1}`,
                  borderRadius: 5,
                  padding: '2px 7px',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                <Locate size={10} />
                {rangeLabel(range)}
              </button>
            )}
          </div>
          <div className="overflow-y-auto" style={{ padding: '8px 14px 12px' }}>
            <div className="font-mono text-xs truncate" style={{ color: mocha.overlay0, marginBottom: scalars.length || childrenOf.length ? 8 : 0 }} title={selectedPath}>
              {selectedPath}
            </div>
            {scalars.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 12, rowGap: 4, alignItems: 'baseline' }}>
                {scalars.map(([k, v]) => (
                  <div key={k} style={{ display: 'contents' }}>
                    <span className="font-mono text-xs" style={{ color: mocha.subtext0 }}>
                      {k}
                    </span>
                    <span className="font-mono text-xs" style={{ color: v === null ? mocha.overlay0 : typeof v === 'string' ? mocha.green : mocha.peach, wordBreak: 'break-all' }}>
                      {JSON.stringify(v)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {childrenOf.length > 0 && (
              <div className="flex flex-wrap gap-1" style={{ marginTop: scalars.length ? 10 : 0 }}>
                {childrenOf.map(([k, v]) => (
                  <span
                    key={k}
                    className="font-mono"
                    style={{ fontSize: 11, color: mocha.overlay1, backgroundColor: mocha.surface0, border: `1px solid ${mocha.surface1}`, borderRadius: 4, padding: '1px 6px' }}
                  >
                    {k}
                    {Array.isArray(v) ? `[${v.length}]` : (v as AnyNode).type ? `: ${(v as AnyNode).type}` : ''}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
