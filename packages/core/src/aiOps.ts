/**
 * Translate an AI plan (which references nodes of the context snapshot by
 * `ref`) into ordinary edit ops. AI edits go through exactly the same
 * op/history pipeline as manual edits.
 */
import type { AIPlan, AIProposedOp } from './api.ts';
import { makeTarget, parseSourceLoc, type EditOp, type ElementTarget } from './model.ts';
import { expandShorthand, normalizeValue, PROPERTIES } from './properties.ts';
import type { ContextNode } from './protocol.ts';

/** Properties the AI may set in addition to the panel's tracked list. */
const EXTRA_ALLOWED = new Set(['background', 'overflow-x', 'overflow-y', 'border', 'text-decoration', 'font-style', 'white-space', 'grid-template-areas', 'grid-area', 'justify-items', 'align-content', 'place-items', 'aspect-ratio', 'object-fit', 'backdrop-filter', 'filter', 'transition']);

export interface ResolvedAIOp {
  op: EditOp;
  proposal: AIProposedOp;
  targetLabel: string;
  before: string | null;
}

export interface ResolveResult {
  ops: ResolvedAIOp[];
  rejected: Array<{ proposal: AIProposedOp; reason: string }>;
}

export function indexContext(root: ContextNode): Map<string, ContextNode> {
  const map = new Map<string, ContextNode>();
  const walk = (n: ContextNode) => {
    map.set(n.ref, n);
    n.children.forEach(walk);
  };
  walk(root);
  return map;
}

export function targetFromContext(node: ContextNode): ElementTarget {
  const src = parseSourceLoc(node.src);
  // Without source mapping, repeated items are addressed as a group so one
  // rule styles every similar element.
  const grouped = !src && node.groupSelector;
  return makeTarget({
    scope: src ? 'source' : 'instance',
    selector: grouped ? node.groupSelector! : node.selector,
    src,
    label: node.label,
    component: null,
    instanceCount: grouped ? node.groupCount ?? 1 : node.instanceCount,
  });
}

export function isAllowedProperty(prop: string): boolean {
  return prop in PROPERTIES || EXTRA_ALLOWED.has(prop) || expandShorthand(prop, '0') !== null;
}

/**
 * Validate and convert proposals. Shorthands are expanded to longhands so
 * the resulting state matches what the style panel would produce.
 */
export function resolvePlan(plan: AIPlan, context: ContextNode): ResolveResult {
  const nodes = indexContext(context);
  const ops: ResolvedAIOp[] = [];
  const rejected: ResolveResult['rejected'] = [];
  for (const proposal of plan.operations) {
    const node = nodes.get(proposal.ref);
    if (!node) {
      rejected.push({ proposal, reason: `Unknown element ref ${proposal.ref}` });
      continue;
    }
    const target = targetFromContext(node);
    if (proposal.kind === 'text') {
      if (!node.textEditable) {
        rejected.push({ proposal, reason: `${node.label} contains nested elements; text cannot be replaced safely` });
        continue;
      }
      ops.push({
        op: { type: 'text', target, value: proposal.value, original: node.text ?? '' },
        proposal,
        targetLabel: node.label,
        before: node.text,
      });
      continue;
    }
    const prop = (proposal.property ?? '').trim().toLowerCase();
    if (!prop || !isAllowedProperty(prop)) {
      rejected.push({ proposal, reason: `Property "${prop}" is not editable` });
      continue;
    }
    const value = normalizeValue(prop, String(proposal.value ?? ''));
    if (!value || /[;{}]/.test(value)) {
      rejected.push({ proposal, reason: `Invalid value for ${prop}` });
      continue;
    }
    const expanded = expandShorthand(prop, value) ?? { [prop]: value };
    for (const [property, v] of Object.entries(expanded)) {
      ops.push({
        op: { type: 'style', target, breakpoint: proposal.breakpoint ?? 'base', property, value: v },
        proposal,
        targetLabel: node.label,
        before: node.styles[property] ?? null,
      });
    }
  }
  return { ops, rejected };
}
