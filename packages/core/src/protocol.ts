/**
 * Wire protocol between the editor (parent window) and the in-page agent
 * (running inside the iframe). The page may live on another origin, so all
 * inspection happens through this postMessage RPC.
 */
import type { EditState, SourceLoc } from './model.ts';

export const PF_CHANNEL = 'pixelforge/v1';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Edges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Geometry for an element, in the iframe's viewport coordinates. */
export interface Geometry {
  nodeId: number;
  /** Border box, axis aligned. */
  rect: Rect;
  /** Border-box corners when the element or an ancestor is transformed. */
  quad: [Point, Point, Point, Point] | null;
  margin: Edges;
  padding: Edges;
  border: Edges;
  label: string;
  /** Visible portion after clipping by scroll containers (null = fully clipped). */
  clip: Rect | null;
  position: string;
  display: string;
  parentDisplay: string;
}

export interface TreeNode {
  id: number;
  tag: string;
  idAttr: string | null;
  classes: string[];
  /** Components whose render output starts at this element (inner first). */
  components: string[];
  src: string | null;
  text: string | null;
  childCount: number;
  children: TreeNode[];
  /** Number of sibling elements rendered from the same source location. */
  repeat: number;
  hidden: boolean;
}

export type OriginKind = 'editor' | 'inline' | 'rule' | 'inherited' | 'default';

export interface DeclarationRef {
  value: string;
  important: boolean;
  selector: string;
  source: string;
  media: string | null;
  kind: 'editor' | 'inline' | 'rule';
}

export interface PropertyOrigin {
  kind: OriginKind;
  /** Specified (cascaded) value, e.g. `50%` or `var(--gap)`. */
  specified: string | null;
  computed: string;
  winner: DeclarationRef | null;
  overridden: DeclarationRef[];
  /** For inherited values: the ancestor that declares it. */
  inheritedFrom: { nodeId: number; label: string } | null;
}

export interface MatchedRule {
  selector: string;
  source: string;
  media: string | null;
  kind: 'editor' | 'inline' | 'rule';
  specificity: [number, number, number];
  declarations: Array<{ property: string; value: string; important: boolean; overridden: boolean }>;
}

export interface InheritedGroup {
  nodeId: number;
  label: string;
  rules: MatchedRule[];
}

export interface ElementDetails {
  nodeId: number;
  tag: string;
  label: string;
  selector: string;
  src: SourceLoc | null;
  instanceCount: number;
  /** Structurally similar elements (URL mode, no source): selector + count. */
  group: { selector: string; count: number } | null;
  components: string[];
  classes: string[];
  attributes: Record<string, string>;
  text: { editable: boolean; value: string; reason?: string };
  computed: Record<string, string>;
  origins: Record<string, PropertyOrigin>;
  rules: MatchedRule[];
  inherited: InheritedGroup[];
  parentDisplay: string;
  parentId: number | null;
  childIds: number[];
  box: { margin: Edges; padding: Edges; border: Edges; width: number; height: number };
  flags: { fixed: boolean; sticky: boolean; transformed: boolean; scrollContainer: boolean; replaced: boolean };
}

/** Compact subtree description sent to AI providers. */
export interface ContextNode {
  ref: string;
  nodeId: number;
  tag: string;
  label: string;
  selector: string;
  src: string | null;
  instanceCount: number;
  groupSelector?: string;
  groupCount?: number;
  text: string | null;
  textEditable: boolean;
  styles: Record<string, string>;
  rect: { width: number; height: number };
  children: ContextNode[];
}

export interface PageInfo {
  url: string;
  title: string;
  framework: string | null;
  sourceMapped: boolean;
  projectRoot: string | null;
  unreadableStylesheets: number;
  role: 'editor' | 'original';
}

export interface ApplyResult {
  unresolved: string[];
  /** Base edits not applied at this width because a site media rule wins. */
  suppressed: Array<{ key: string; property: string; media: string }>;
}

export interface AgentMethods {
  init(params: { role: 'editor' | 'original' }): PageInfo;
  setMode(params: { mode: 'select' | 'interact' }): void;
  setState(params: { state: EditState }): ApplyResult;
  select(params: { nodeId: number | null }): Geometry | null;
  hover(params: { nodeId: number | null }): Geometry | null;
  resolve(params: { selector: string; src: string | null; instanceIndex?: number }): number | null;
  getTree(params: Record<string, never>): TreeNode;
  getDetails(params: { nodeId: number }): ElementDetails | null;
  getContext(params: { nodeId: number; depth?: number }): ContextNode | null;
  scrollIntoView(params: { nodeId: number }): void;
  scrollTo(params: { x: number; y: number }): void;
  measure(params: { nodeIds: number[] }): Array<Geometry | null>;
  links(params: Record<string, never>): Array<{ href: string; text: string }>;
  editText(params: { nodeId: number }): boolean;
  setSyncScroll(params: { enabled: boolean }): void;
}

export type AgentMethod = keyof AgentMethods;

export interface AgentEvents {
  ready: PageInfo;
  hover: { geometry: Geometry | null };
  select: { nodeId: number | null; geometry: Geometry | null; shift: boolean };
  geometry: { hover: Geometry | null; selected: Geometry | null };
  treeChanged: Record<string, never>;
  key: { key: string; code: string; meta: boolean; ctrl: boolean; shift: boolean; alt: boolean };
  textCommit: { nodeId: number; text: string };
  scroll: { x: number; y: number };
  applied: ApplyResult;
  navigate: { url: string };
  error: { message: string };
}

export type AgentEventName = keyof AgentEvents;

export interface RpcRequest {
  channel: typeof PF_CHANNEL;
  kind: 'request';
  id: number;
  method: AgentMethod;
  params: unknown;
}

export interface RpcResponse {
  channel: typeof PF_CHANNEL;
  kind: 'response';
  id: number;
  result?: unknown;
  error?: string;
}

export interface RpcEvent {
  channel: typeof PF_CHANNEL;
  kind: 'event';
  event: AgentEventName;
  data: unknown;
}

export type RpcMessage = RpcRequest | RpcResponse | RpcEvent;

export function isRpcMessage(v: unknown): v is RpcMessage {
  return !!v && typeof v === 'object' && (v as { channel?: string }).channel === PF_CHANNEL;
}
