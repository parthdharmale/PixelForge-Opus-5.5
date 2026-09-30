import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { AIProviderInfo, AIRequest } from '@pixelforge/core';
import type { AIProvider } from './provider.ts';
import { SYSTEM_PROMPT, userPrompt } from './prompt.ts';

const PlanSchema = z.object({
  summary: z.string(),
  rationale: z.array(z.string()),
  operations: z.array(
    z.object({
      ref: z.string(),
      kind: z.enum(['style', 'text']),
      property: z.string().nullable(),
      value: z.string(),
      breakpoint: z.enum(['base', 'tablet', 'mobile']),
      reason: z.string(),
    }),
  ),
});

export class AnthropicProvider implements AIProvider {
  private client: Anthropic | null = null;
  readonly model = process.env.PF_AI_MODEL ?? 'claude-opus-5-5';

  private hasCredentials(): boolean {
    return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  }

  info(): AIProviderInfo {
    const available = this.hasCredentials();
    return { id: 'anthropic', label: 'Claude', available, model: this.model, reason: available ? undefined : 'Set ANTHROPIC_API_KEY to enable' };
  }

  async plan(req: AIRequest, signal?: AbortSignal) {
    if (!this.hasCredentials()) throw new Error('ANTHROPIC_API_KEY is not set');
    this.client ??= new Anthropic();
    const response = await this.client.beta.messages.parse(
      {
        model: this.model,
        max_tokens: 16000,
        // Route to a fallback model automatically if a safety classifier declines.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium', format: betaZodOutputFormat(PlanSchema) },
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt(req) }],
      },
      { signal },
    );
    if (response.stop_reason === 'refusal') throw new Error('The model declined this request.');
    if (response.stop_reason === 'max_tokens') throw new Error('The plan was too long and got cut off; try a narrower instruction or a smaller selection.');
    const parsed = response.parsed_output;
    if (!parsed) throw new Error('The model did not return a valid plan.');
    return {
      summary: parsed.summary,
      rationale: parsed.rationale,
      operations: parsed.operations.map((o) => ({ ref: o.ref, kind: o.kind, property: o.property ?? undefined, value: o.value, breakpoint: o.breakpoint, reason: o.reason })),
      model: response.model,
      warnings: [],
    };
  }
}
