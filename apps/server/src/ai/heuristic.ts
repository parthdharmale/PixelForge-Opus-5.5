/**
 * Offline design engine used when no LLM credentials are configured.
 *
 * This is *not* a mock: it analyses the real subtree snapshot (roles,
 * sizes, computed styles, repeated children) and derives edit operations
 * from recognised intents (premium, developer-tool look, decluttering,
 * hierarchy, responsive grid, mobile navigation, spacing, size, radius,
 * alignment, colour...). It is deliberately labelled as heuristic in the
 * UI, and it says so when it does not understand an instruction.
 */
import type { AIProposedOp, AIProviderInfo, AIRequest, BreakpointId, ContextNode } from '@pixelforge/core';
import type { AIProvider } from './provider.ts';

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(v: string | undefined): Rgba | null {
  if (!v) return null;
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(v);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  const h = /^#([0-9a-f]{6})$/i.exec(v.trim());
  if (h) return { r: parseInt(h[1].slice(0, 2), 16), g: parseInt(h[1].slice(2, 4), 16), b: parseInt(h[1].slice(4, 6), 16), a: 1 };
  return null;
}

function luminance(c: Rgba): number {
  const f = (x: number) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

function hex(c: Rgba): string {
  return `#${[c.r, c.g, c.b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')}`;
}

function mix(a: Rgba, b: Rgba, t: number): Rgba {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: 1 };
}

function px(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^(-?[\d.]+)px$/.exec(v.trim());
  return m ? Number(m[1]) : null;
}

const round = (n: number, step = 1) => Math.round(n / step) * step;

function walk(n: ContextNode, fn: (n: ContextNode, depth: number, parent: ContextNode | null) => void, depth = 0, parent: ContextNode | null = null) {
  fn(n, depth, parent);
  n.children.forEach((c) => walk(c, fn, depth + 1, n));
}

function all(root: ContextNode): ContextNode[] {
  const out: ContextNode[] = [];
  walk(root, (n) => out.push(n));
  return out;
}

function fontSize(n: ContextNode): number {
  return px(n.styles['font-size']) ?? 16;
}

function isHeading(n: ContextNode): boolean {
  return /^h[1-6]$/.test(n.tag) || (!!n.text && fontSize(n) >= 24 && Number(n.styles['font-weight'] ?? 400) >= 600);
}

function isButton(n: ContextNode): boolean {
  return n.tag === 'button' || (n.tag === 'a' && (px(n.styles['padding-left']) ?? 0) >= 8 && (!!n.styles['background-color'] || !!n.styles['border-top-style']));
}

function isBodyText(n: ContextNode): boolean {
  return !!n.text && n.textEditable && !isHeading(n) && !isButton(n) && ['p', 'span', 'li', 'dd', 'blockquote', 'figcaption', 'div', 'small'].includes(n.tag) && n.text.length > 25;
}

/** Siblings that look like repeated items (cards). */
function repeatedGroup(root: ContextNode): { container: ContextNode; items: ContextNode[] } | null {
  let best: { container: ContextNode; items: ContextNode[] } | null = null;
  walk(root, (n) => {
    if (n.children.length < 2) return;
    const groups = new Map<string, ContextNode[]>();
    for (const c of n.children) {
      const k = `${c.tag}|${c.label}`;
      groups.set(k, [...(groups.get(k) ?? []), c]);
    }
    for (const items of groups.values()) {
      if (items.length >= 2 && items.length >= n.children.length * 0.6 && (!best || items.length > best.items.length)) best = { container: n, items };
    }
  });
  return best;
}

function isCardLike(n: ContextNode): boolean {
  return !!(n.styles['background-color'] || n.styles['border-top-style'] || n.styles['box-shadow']) && n.children.length > 0;
}

class Plan {
  ops: AIProposedOp[] = [];
  rationale: string[] = [];
  skippedShared = new Set<string>();
  private seen = new Set<string>();

  constructor(private occurrences: Map<string, number>) {}

  /**
   * Elements rendered from a shared component that also appears outside
   * the selection would change everywhere; leave them alone so the edit
   * stays within what the user selected.
   */
  private sharedOutside(n: ContextNode): boolean {
    const key = n.src ?? n.groupSelector;
    const total = n.src ? n.instanceCount : n.groupCount ?? 1;
    return !!key && total > (this.occurrences.get(key) ?? 1);
  }

  set(n: ContextNode, property: string, value: string, reason: string, breakpoint: BreakpointId = 'base') {
    if (this.sharedOutside(n)) {
      this.skippedShared.add(n.label);
      return;
    }
    const k = `${n.ref}|${property}|${breakpoint}`;
    if (this.seen.has(k)) return;
    const current = n.styles[property];
    if (breakpoint === 'base' && current === value) return;
    this.seen.add(k);
    this.ops.push({ ref: n.ref, kind: 'style', property, value, breakpoint, reason });
  }

  why(r: string) {
    if (!this.rationale.includes(r)) this.rationale.push(r);
  }
}

interface Env {
  root: ContextNode;
  nodes: ContextNode[];
  dark: boolean;
  text: Rgba;
  bg: Rgba;
  bp: BreakpointId;
}

type Recipe = { name: string; match: RegExp; apply: (p: Plan, env: Env, instruction: string) => void };

function scaleSpacing(p: Plan, env: Env, factor: number, reason: string) {
  for (const n of env.nodes) {
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const v = px(n.styles[`padding-${side}`]);
      if (v && v >= 4) p.set(n, `padding-${side}`, `${round(v * factor, 4)}px`, reason);
    }
    for (const g of ['row-gap', 'column-gap']) {
      const v = px(n.styles[g]);
      if (v && v >= 4) p.set(n, g, `${round(v * factor, 4)}px`, reason);
    }
  }
}

const RECIPES: Recipe[] = [
  {
    name: 'grid',
    match: /\bgrid\b|columns|into (a )?(responsive )?(layout|grid)|responsive grid/i,
    apply(p, env) {
      const g = repeatedGroup(env.root);
      if (!g) return;
      const avg = g.items.reduce((s, i) => s + i.rect.width, 0) / g.items.length;
      const min = Math.max(200, Math.min(340, round(avg * 0.75, 20)));
      const gap = px(g.container.styles['column-gap']) ?? px(g.container.styles['row-gap']) ?? 24;
      p.set(g.container, 'display', 'grid', 'Grid lays the repeated items out in rows and columns');
      p.set(g.container, 'grid-template-columns', `repeat(auto-fit, minmax(${min}px, 1fr))`, `Columns wrap automatically once items would get narrower than ${min}px`);
      p.set(g.container, 'row-gap', `${Math.max(gap, 16)}px`, 'Consistent gutters between rows');
      p.set(g.container, 'column-gap', `${Math.max(gap, 16)}px`, 'Consistent gutters between columns');
      p.set(g.container, 'align-items', 'stretch', 'Equal-height items');
      for (const it of g.items) {
        if (it.styles['flex-grow'] || it.styles['flex-basis']) p.set(it, 'flex-basis', 'auto', 'Flex sizing no longer applies inside a grid');
        break;
      }
      p.why(`Turned ${g.items.length} repeated ${g.items[0].label} items into a responsive auto-fit grid (no media queries needed).`);
    },
  },
  {
    name: 'mobile-nav',
    match: /(mobile|phone|small screen).*(nav|menu|header)|(nav|menu|header).*(mobile|phone|small screen)/i,
    apply(p, env) {
      const isList = (n: ContextNode) => n.children.length >= 3 && n.children.every((c) => ['li', 'a'].includes(c.tag));
      const lists = env.nodes.filter(isList);
      const bar = env.nodes.find((n) => n.styles.display === 'flex' && n.children.length >= 2 && !isList(n)) ?? env.root;
      p.set(bar, 'flex-wrap', 'wrap', 'Let the bar wrap instead of overflowing on narrow screens', 'mobile');
      p.set(bar, 'row-gap', '4px', 'Tight spacing between the wrapped rows', 'mobile');
      if (px(bar.styles.height)) {
        p.set(bar, 'height', 'auto', 'Allow the bar to grow for the second row', 'mobile');
        p.set(bar, 'min-height', bar.styles.height, 'Keep the original bar height for the first row', 'mobile');
      }
      for (const list of lists) {
        p.set(list, 'display', 'flex', list.hidden ? 'Links were hidden behind a menu; show them directly' : 'Keep links visible', 'mobile');
        p.set(list, 'order', '3', 'Move links to their own row below the logo and actions', 'mobile');
        p.set(list, 'width', '100%', 'Full-width row for links', 'mobile');
        p.set(list, 'overflow-x', 'auto', 'Swipe horizontally when links do not fit', 'mobile');
        p.set(list, 'column-gap', '20px', 'Comfortable spacing between touch targets', 'mobile');
        p.set(list, 'white-space', 'nowrap', 'Keep each link on one line', 'mobile');
        p.set(list, 'padding-bottom', '10px', 'Space below the scrolling row', 'mobile');
      }
      // A hamburger toggle becomes redundant once the links are visible.
      const toggle = env.nodes.find((n) => n.tag === 'button' && !n.text && n.children.length <= 4 && n.children.every((c) => !c.text));
      if (toggle && lists.length) p.set(toggle, 'display', 'none', 'The menu toggle is redundant with visible links', 'mobile');
      for (const n of env.nodes) if (n.tag === 'a' && n.text && fontSize(n) < 16 && !n.hidden) p.set(n, 'font-size', '16px', 'Readable, tappable link text (≥16px)', 'mobile');
      p.why('On mobile the navigation wraps: brand and actions stay on top, links move to a swipeable row with touch-friendly sizing, and the redundant menu toggle is hidden.');
    },
  },
  {
    name: 'premium',
    match: /premium|luxur|elegant|polish|high[- ]end|refined|sophisticat/i,
    apply(p, env) {
      scaleSpacing(p, env, 1.25, 'More generous whitespace reads as premium');
      for (const n of env.nodes) {
        if (isHeading(n)) {
          p.set(n, 'letter-spacing', fontSize(n) >= 32 ? '-0.03em' : '-0.015em', 'Tighter tracking on display type');
          p.set(n, 'line-height', fontSize(n) >= 32 ? '1.05' : '1.25', 'Compact heading leading');
          if (fontSize(n) >= 28) p.set(n, 'font-size', `${round(fontSize(n) * 1.12)}px`, 'Larger, more confident headline');
        } else if (isBodyText(n)) {
          p.set(n, 'line-height', '1.7', 'Airier body copy');
          p.set(n, 'color', hex(mix(env.text, env.bg, 0.3)), 'Softer secondary text creates contrast with headings');
        }
        if (isCardLike(n) && n !== env.root) {
          p.set(n, 'border-top-left-radius', '16px', 'Softer corners');
          p.set(n, 'border-top-right-radius', '16px', 'Softer corners');
          p.set(n, 'border-bottom-right-radius', '16px', 'Softer corners');
          p.set(n, 'border-bottom-left-radius', '16px', 'Softer corners');
          p.set(n, 'box-shadow', env.dark ? '0 1px 0 rgba(255,255,255,0.06) inset, 0 24px 48px -12px rgba(0,0,0,0.55)' : '0 1px 2px rgba(16,24,40,0.04), 0 16px 40px -12px rgba(16,24,40,0.18)', 'Layered, diffuse shadow for depth');
        }
        if (isButton(n)) {
          p.set(n, 'border-top-left-radius', '999px', 'Pill buttons');
          p.set(n, 'border-top-right-radius', '999px', 'Pill buttons');
          p.set(n, 'border-bottom-right-radius', '999px', 'Pill buttons');
          p.set(n, 'border-bottom-left-radius', '999px', 'Pill buttons');
          const pl = px(n.styles['padding-left']);
          if (pl) {
            p.set(n, 'padding-left', `${round(pl * 1.3, 2)}px`, 'Roomier buttons');
            p.set(n, 'padding-right', `${round(pl * 1.3, 2)}px`, 'Roomier buttons');
          }
        }
      }
      p.why('Premium feel: more whitespace, tighter display typography, softer secondary text, rounded surfaces with diffuse depth, pill-shaped actions.');
    },
  },
  {
    name: 'devtool',
    match: /developer|dev tool|devtool|technical|engineer|terminal|hacker|code/i,
    apply(p, env) {
      const mono = "ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, monospace";
      for (const n of env.nodes) {
        if (n.text && n.textEditable && (fontSize(n) <= 14 || n.styles['text-transform'] === 'uppercase') && !isBodyText(n)) {
          p.set(n, 'font-family', mono, 'Monospace labels signal a technical product');
          p.set(n, 'letter-spacing', '0', 'Monospace needs no extra tracking');
          p.set(n, 'text-transform', 'none', 'Lowercase, code-like labels');
        }
        if (isHeading(n)) {
          p.set(n, 'letter-spacing', '-0.035em', 'Tight, engineered display type');
          p.set(n, 'font-weight', '600', 'Crisper weight than heavy marketing headlines');
        }
        if (isCardLike(n) && n !== env.root) {
          ['top-left', 'top-right', 'bottom-right', 'bottom-left'].forEach((c) => p.set(n, `border-${c}-radius`, '8px', 'Sharper, tool-like corners'));
          ['top', 'right', 'bottom', 'left'].forEach((s) => {
            p.set(n, `border-${s}-width`, '1px', 'Hairline borders instead of shadows');
            p.set(n, `border-${s}-style`, 'solid', 'Hairline borders instead of shadows');
            p.set(n, `border-${s}-color`, env.dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)', 'Subtle hairline');
          });
          p.set(n, 'box-shadow', 'none', 'Flat surfaces');
        }
        if (isButton(n)) ['top-left', 'top-right', 'bottom-right', 'bottom-left'].forEach((c) => p.set(n, `border-${c}-radius`, '6px', 'Squarer buttons match the tool aesthetic'));
      }
      p.why('Developer-tool aesthetic: monospace labels, tight headings, flat surfaces with hairline borders and small radii.');
    },
  },
  {
    name: 'declutter',
    match: /clutter|simplif|cleaner|minimal|calm|less busy|noise/i,
    apply(p, env) {
      scaleSpacing(p, env, 1.2, 'More whitespace separates groups');
      for (const n of env.nodes) {
        if (n.styles['box-shadow'] && n !== env.root) p.set(n, 'box-shadow', 'none', 'Remove competing shadows');
        if (!isHeading(n) && n.text && Number(n.styles['font-weight'] ?? 400) >= 600 && !isButton(n) && fontSize(n) < 20) p.set(n, 'font-weight', '500', 'Fewer bold elements competing for attention');
        if (n.styles['text-transform'] === 'uppercase' && fontSize(n) < 14) p.set(n, 'text-transform', 'none', 'Quieter labels');
        if (isBodyText(n)) p.set(n, 'max-width', '62ch', 'Comfortable line length');
        if (n.styles['border-top-color'] && isCardLike(n) && n !== env.root) {
          ['top', 'right', 'bottom', 'left'].forEach((s) => p.set(n, `border-${s}-color`, env.dark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)', 'Lighter borders'));
        }
      }
      p.why('Less visual noise: fewer shadows and bold weights, lighter borders, calmer labels and more space between groups.');
    },
  },
  {
    name: 'hierarchy',
    match: /hierarch|emphasi|stand out|readab|scan/i,
    apply(p, env) {
      const heads = env.nodes.filter(isHeading).sort((a, b) => fontSize(b) - fontSize(a));
      heads.forEach((h, i) => {
        const f = i === 0 ? 1.25 : 1.08;
        p.set(h, 'font-size', `${round(fontSize(h) * f)}px`, i === 0 ? 'Make the primary heading clearly dominant' : 'Secondary headings step up slightly');
        p.set(h, 'font-weight', i === 0 ? '800' : '650', 'Weight contrast between levels');
        p.set(h, 'letter-spacing', i === 0 ? '-0.03em' : '-0.01em', 'Tighter tracking at larger sizes');
        p.set(h, 'line-height', i === 0 ? '1.08' : '1.25', 'Heading leading');
      });
      for (const n of env.nodes) {
        if (isBodyText(n)) {
          p.set(n, 'color', hex(mix(env.text, env.bg, 0.35)), 'Muted supporting text so headings lead');
          p.set(n, 'line-height', '1.65', 'Readable body copy');
        }
      }
      if (heads[0]) p.set(heads[0], 'margin-bottom', '16px', 'Clear gap between the headline and its support text');
      p.why('Clear typographic scale: one dominant heading, stepped secondary headings, muted supporting copy. Content unchanged.');
    },
  },
  {
    name: 'spacing-more',
    match: /more (space|spacing|padding|room|breathing)|airy|spacious|breath/i,
    apply(p, env) {
      scaleSpacing(p, env, 1.5, 'Increase spacing');
      p.why('Spacing increased by 50% (padding and gaps).');
    },
  },
  {
    name: 'spacing-less',
    match: /tight|compact|dense|less (space|spacing|padding)|condens/i,
    apply(p, env) {
      scaleSpacing(p, env, 0.7, 'Reduce spacing');
      p.why('Spacing reduced by 30% (padding and gaps).');
    },
  },
  {
    name: 'bigger',
    match: /\b(bigger|larger|increase (the )?(size|font))\b/i,
    apply(p, env) {
      for (const n of env.nodes) if (n.text) p.set(n, 'font-size', `${round(fontSize(n) * 1.2)}px`, 'Larger text');
      p.why('Text scaled up by 20%.');
    },
  },
  {
    name: 'smaller',
    match: /\b(smaller|reduce (the )?(size|font)|shrink)\b/i,
    apply(p, env) {
      for (const n of env.nodes) if (n.text) p.set(n, 'font-size', `${round(fontSize(n) * 0.85)}px`, 'Smaller text');
      p.why('Text scaled down by 15%.');
    },
  },
  {
    name: 'rounded',
    match: /round|soft(er)? corner|pill/i,
    apply(p, env) {
      const targets = env.nodes.filter((n) => isCardLike(n) || isButton(n) || n === env.root);
      for (const n of targets) ['top-left', 'top-right', 'bottom-right', 'bottom-left'].forEach((c) => p.set(n, `border-${c}-radius`, isButton(n) ? '999px' : '16px', 'Rounder corners'));
      p.why('Rounder corners on surfaces and buttons.');
    },
  },
  {
    name: 'center',
    match: /\bcent(er|re)\b/i,
    apply(p, env) {
      p.set(env.root, 'text-align', 'center', 'Center text');
      for (const n of env.nodes) if (n.styles.display === 'flex') p.set(n, 'justify-content', 'center', 'Center flex content');
      p.why('Content centred.');
    },
  },
  {
    name: 'bold',
    match: /\bbold(er)?\b|heavier|stronger/i,
    apply(p, env) {
      for (const n of env.nodes) if (n.text) p.set(n, 'font-weight', isHeading(n) ? '800' : '600', 'Heavier weight');
      p.why('Heavier font weights.');
    },
  },
  {
    name: 'shadow',
    match: /shadow|elevat|depth|lift/i,
    apply(p, env) {
      const targets = env.nodes.filter((n) => isCardLike(n)).slice(0, 12);
      for (const n of targets.length ? targets : [env.root]) p.set(n, 'box-shadow', env.dark ? '0 20px 40px -12px rgba(0,0,0,0.6)' : '0 12px 32px -8px rgba(16,24,40,0.2)', 'Elevation');
      p.why('Added elevation with soft shadows.');
    },
  },
  {
    name: 'hide',
    match: /\b(hide|remove)\b/i,
    apply(p, env, instruction) {
      const bp: BreakpointId = /mobile|phone/i.test(instruction) ? 'mobile' : /tablet/i.test(instruction) ? 'tablet' : 'base';
      p.set(env.root, 'display', 'none', 'Hide the selected element', bp);
      p.why(bp === 'base' ? 'Element hidden at all sizes.' : `Element hidden at the ${bp} breakpoint only.`);
    },
  },
];

const COLORS: Record<string, string> = { red: '#ef4444', orange: '#f97316', yellow: '#eab308', green: '#22c55e', teal: '#14b8a6', blue: '#3b82f6', indigo: '#6366f1', purple: '#a855f7', violet: '#8b5cf6', pink: '#ec4899', black: '#000000', white: '#ffffff', gray: '#6b7280', grey: '#6b7280' };

export class HeuristicProvider implements AIProvider {
  info(): AIProviderInfo {
    return { id: 'heuristic', label: 'Offline heuristic engine', available: true, model: 'rules v1' };
  }

  async plan(req: AIRequest) {
    const nodes = all(req.context);
    const textColors = nodes.map((n) => parseColor(n.styles.color)).filter((c): c is Rgba => !!c);
    const text = textColors[0] ?? { r: 20, g: 20, b: 20, a: 1 };
    const dark = luminance(text) > 0.5;
    const bgNode = nodes.map((n) => parseColor(n.styles['background-color'])).find((c) => c && c.a > 0.5);
    const bg = bgNode ?? (dark ? { r: 11, g: 13, b: 18, a: 1 } : { r: 255, g: 255, b: 255, a: 1 });
    const env: Env = { root: req.context, nodes, dark, text, bg, bp: req.viewport.breakpoint };
    const occurrences = new Map<string, number>();
    for (const n of nodes) {
      const key = n.src ?? n.groupSelector;
      if (key) occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
    }
    const plan = new Plan(occurrences);
    const matched: string[] = [];
    for (const r of RECIPES) {
      if (!r.match.test(req.instruction)) continue;
      // "hide" and "center" are only meant as direct commands.
      if (matched.length && ['hide'].includes(r.name)) continue;
      r.apply(plan, env, req.instruction);
      matched.push(r.name);
    }
    const color = /(background|bg|text|font|color|colour)?[^.]*?\b(red|orange|yellow|green|teal|blue|indigo|purple|violet|pink|black|white|gray|grey)\b/i.exec(req.instruction);
    if (color && /colou?r|background|\bbg\b|make .* (red|orange|yellow|green|teal|blue|indigo|purple|violet|pink|black|white|gray|grey)/i.test(req.instruction)) {
      const value = COLORS[color[2].toLowerCase()];
      const prop = /background|\bbg\b/i.test(req.instruction) || isButton(req.context) ? 'background-color' : 'color';
      plan.set(req.context, prop, value, `Set ${prop.replace('-', ' ')} to ${color[2]}`);
      plan.why(`${prop === 'color' ? 'Text' : 'Background'} colour set to ${color[2]}.`);
      matched.push('color');
    }
    const warnings: string[] = [];
    if (plan.skippedShared.size) plan.why(`Left ${[...plan.skippedShared].join(', ')} unchanged: ${plan.skippedShared.size > 1 ? 'they are' : 'it is'} rendered by a shared component that also appears outside this selection (edit it directly to change it everywhere).`);
    if (!matched.length || !plan.ops.length) {
      warnings.push('The offline engine did not recognise an actionable intent in this instruction. It understands: premium, developer-tool style, reduce clutter, hierarchy, responsive grid, mobile navigation, more/less spacing, bigger/smaller, rounded, center, bold, shadow, hide, and colours. Set ANTHROPIC_API_KEY for open-ended instructions.');
    }
    return {
      summary: matched.length ? `Applied ${matched.join(', ')} heuristics to ${req.context.label}: ${plan.ops.length} change${plan.ops.length === 1 ? '' : 's'}.` : 'No changes proposed.',
      rationale: plan.rationale,
      operations: plan.ops.slice(0, 60),
      model: 'rules v1',
      warnings,
    };
  }
}
