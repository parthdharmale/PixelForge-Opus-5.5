/** Types shared between the editor and the server's HTTP API. */
import type { BreakpointId } from './breakpoints.ts';
import type { EditState } from './model.ts';
import type { ContextNode, Rect } from './protocol.ts';

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export interface AIRequest {
  instruction: string;
  context: ContextNode;
  viewport: { width: number; breakpoint: BreakpointId };
  page: { url: string; title: string };
}

export interface AIProposedOp {
  /** `ref` of a node in the request context (e.g. "n3"). */
  ref: string;
  kind: 'style' | 'text';
  property?: string;
  value: string;
  breakpoint: BreakpointId;
  reason?: string;
}

export interface AIPlan {
  summary: string;
  rationale: string[];
  operations: AIProposedOp[];
  provider: string;
  model: string | null;
  warnings: string[];
  durationMs: number;
}

export interface AIProviderInfo {
  id: string;
  label: string;
  available: boolean;
  reason?: string;
  model?: string;
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

export type MappingStrategy =
  | 'css-module'
  | 'css-rule'
  | 'tailwind'
  | 'inline-style'
  | 'jsx-text'
  | 'string-literal'
  | 'html-text'
  | 'override-css';

export interface ChangeMapping {
  targetKey: string;
  label: string;
  strategy: MappingStrategy | null;
  file: string | null;
  detail: string;
  status: 'mapped' | 'warning' | 'unmapped';
  message?: string;
  properties: string[];
}

export interface FilePatch {
  path: string;
  before: string;
  after: string;
  diff: string;
  created: boolean;
}

export interface PatchResult {
  id: string;
  mode: 'source' | 'url';
  files: FilePatch[];
  mappings: ChangeMapping[];
  warnings: string[];
  createdAt: number;
  state: EditState;
}

// ---------------------------------------------------------------------------
// Projects & verification
// ---------------------------------------------------------------------------

export interface ProjectStatus {
  id: string;
  name: string;
  root: string;
  url: string | null;
  status: 'starting' | 'ready' | 'error' | 'stopped';
  framework: string;
  isDemo: boolean;
  error?: string;
  appliedPatches: Array<{ id: string; files: string[]; appliedAt: number; reverted: boolean }>;
}

export interface VerifyViewport {
  id: string;
  width: number;
  height: number;
}

export interface ViewportVerification {
  viewport: VerifyViewport;
  images: { baseline: string; expected: string; actual: string; diffExpected: string; diffBaseline: string };
  /** Fraction of pixels differing between expected (live edits) and actual (patched source). */
  mismatchVsExpected: number;
  /** Fraction of pixels differing between baseline (before) and actual (after). */
  changedVsBaseline: number;
  unexpectedRegions: Rect[];
  changedRegions: Rect[];
  size: { width: number; height: number };
  status: 'passed' | 'warning' | 'failed';
}

export interface PropertyCheck {
  targetLabel: string;
  selector: string;
  property: string;
  breakpoint: BreakpointId;
  viewport: string;
  expected: string;
  actual: string | null;
  pass: boolean;
}

export interface VerificationReport {
  id: string;
  patchId: string;
  status: 'passed' | 'warning' | 'failed';
  summary: string;
  viewports: ViewportVerification[];
  propertyChecks: PropertyCheck[];
  consoleErrors: string[];
  durationMs: number;
}

export interface JobStep {
  label: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped';
  detail?: string;
}

export interface Job<T = unknown> {
  id: string;
  kind: string;
  status: 'running' | 'done' | 'error';
  steps: JobStep[];
  result?: T;
  error?: string;
  startedAt: number;
}

export interface OpenUrlResponse {
  frameUrl: string;
  originalUrl: string;
}

/** Tolerance below which two renderings count as visually identical. */
export const VERIFY_TOLERANCE = 0.001;
