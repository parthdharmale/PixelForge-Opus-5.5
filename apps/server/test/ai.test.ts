import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolvePlan, type AIRequest, type ContextNode } from '@pixelforge/core';
import { HeuristicProvider } from '../src/ai/heuristic';
import { AnthropicProvider } from '../src/ai/anthropic';

function node(ref: string, tag: string, label: string, styles: Record<string, string>, children: ContextNode[] = [], extra: Partial<ContextNode> = {}): ContextNode {
  return { ref, nodeId: Number(ref.slice(1)), tag, label, selector: `#${ref}`, src: `src/X.tsx:${ref.slice(1)}:0`, instanceCount: 1, text: null, textEditable: false, styles, rect: { width: 320, height: 200 }, children, ...extra };
}

const cards = [1, 2, 3].map((i) =>
  node(`n${i + 1}`, 'article', 'article.card', { 'padding-top': '24px', 'background-color': 'rgb(18, 21, 29)', 'border-top-style': 'solid' }, [node(`n${i + 10}`, 'h3', 'h3.title', { 'font-size': '18px', 'font-weight': '600' }, [], { text: 'Title', textEditable: true })], { src: 'src/Card.tsx:3:4', instanceCount: 3 }),
);
const grid = node('n1', 'div', 'div.cards', { display: 'flex', 'column-gap': '16px' }, cards);
const section = node('n0', 'section', 'section.features', { 'padding-top': '80px', 'padding-bottom': '80px', color: 'rgb(232, 234, 240)' }, [grid]);

const req = (instruction: string, context: ContextNode = section): AIRequest => ({ instruction, context, viewport: { width: 1440, breakpoint: 'base' }, page: { url: 'http://x', title: 'X' } });

describe('heuristic provider', () => {
  const ai = new HeuristicProvider();

  it('turns repeated cards into an auto-fit grid on their container', async () => {
    const plan = await ai.plan(req('Turn these cards into a responsive grid'));
    const byProp = Object.fromEntries(plan.operations.filter((o) => o.ref === 'n1').map((o) => [o.property, o.value]));
    expect(byProp.display).toBe('grid');
    expect(byProp['grid-template-columns']).toMatch(/^repeat\(auto-fit, minmax\(\d+px, 1fr\)\)$/);
    // Ops must pass the same validation as LLM output.
    const { rejected } = resolvePlan({ ...plan, provider: 'heuristic', durationMs: 0 }, section);
    expect(rejected).toEqual([]);
  });

  it('produces coherent premium changes derived from the actual styles', async () => {
    const plan = await ai.plan(req('Make this section more premium'));
    const sectionPad = plan.operations.find((o) => o.ref === 'n0' && o.property === 'padding-top');
    expect(sectionPad?.value).toBe('100px'); // 80px × 1.25
    expect(plan.operations.some((o) => o.ref === 'n2' && o.property === 'box-shadow')).toBe(true);
    expect(plan.rationale.length).toBeGreaterThan(0);
  });

  it('does not touch components shared outside the selection', async () => {
    const single = node('n0', 'section', 'section.hero', { 'padding-top': '80px' }, [node('n5', 'a', 'a.btn', { 'padding-left': '20px', 'padding-top': '12px', 'background-color': 'rgb(109, 93, 252)' }, [], { src: 'src/Button.tsx:5:4', instanceCount: 5, text: 'Go', textEditable: true })]);
    const plan = await ai.plan(req('Make this hero more premium', single));
    expect(plan.operations.some((o) => o.ref === 'n5')).toBe(false);
    expect(plan.rationale.join(' ')).toMatch(/a\.btn unchanged/);
  });

  it('targets the mobile breakpoint for mobile navigation requests', async () => {
    const links = node('n2', 'ul', 'ul.links', { display: 'none' }, ['A', 'B', 'C'].map((t, i) => node(`n${i + 3}`, 'li', 'li', {}, [], { text: t })), { hidden: true });
    const toggle = node('n7', 'button', 'button.menu', {}, [node('n8', 'span', 'span', {})]);
    const nav = node('n0', 'nav', 'nav.nav', { display: 'flex', height: '64px' }, [node('n1', 'a', 'a.brand', {}, [], { text: 'Brand' }), links, toggle]);
    const plan = await ai.plan(req('Make this navigation work better on mobile', nav));
    expect(plan.operations.every((o) => o.breakpoint === 'mobile')).toBe(true);
    expect(plan.operations).toContainEqual(expect.objectContaining({ ref: 'n2', property: 'display', value: 'flex' }));
    expect(plan.operations).toContainEqual(expect.objectContaining({ ref: 'n7', property: 'display', value: 'none' }));
  });

  it('says so when it does not understand', async () => {
    const plan = await ai.plan(req('Write a poem about the sea'));
    expect(plan.operations).toEqual([]);
    expect(plan.warnings[0]).toMatch(/did not recognise/);
  });
});

describe('Anthropic provider (against a mock Messages API)', () => {
  let server: http.Server;
  let lastBody: Record<string, unknown> | null = null;
  let lastHeaders: http.IncomingHttpHeaders = {};
  const env = { key: process.env.ANTHROPIC_API_KEY, base: process.env.ANTHROPIC_BASE_URL };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        lastBody = JSON.parse(body);
        lastHeaders = req.headers;
        const plan = { summary: 'Tighter heading', rationale: ['Heavier weight'], operations: [{ ref: 'n11', kind: 'style', property: 'font-weight', value: '700', breakpoint: 'base', reason: 'Emphasis' }] };
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify(plan) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(() => {
    server.close();
    process.env.ANTHROPIC_API_KEY = env.key;
    process.env.ANTHROPIC_BASE_URL = env.base;
    if (env.key === undefined) delete process.env.ANTHROPIC_API_KEY;
    if (env.base === undefined) delete process.env.ANTHROPIC_BASE_URL;
  });

  it('sends a structured-output request and parses the plan', async () => {
    const ai = new AnthropicProvider();
    expect(ai.info().available).toBe(true);
    const plan = await ai.plan(req('Emphasise the card titles'));
    expect(plan.operations).toEqual([{ ref: 'n11', kind: 'style', property: 'font-weight', value: '700', breakpoint: 'base', reason: 'Emphasis' }]);
    expect(lastBody?.model).toBe('claude-opus-5-5');
    expect((lastBody?.output_config as { format: { type: string } }).format.type).toBe('json_schema');
    expect(String(lastHeaders['anthropic-beta'])).toContain('server-side-fallback');
    const user = (lastBody?.messages as Array<{ content: string }>)[0].content;
    expect(user).toContain('Emphasise the card titles');
    expect(user).toContain('"ref": "n11"');
  });
});
