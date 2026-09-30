import type { AIPlan, AIProviderInfo, AIRequest } from '@pixelforge/core';
import { AnthropicProvider } from './anthropic.ts';
import { HeuristicProvider } from './heuristic.ts';
import type { AIProvider } from './provider.ts';

const providers: Record<string, AIProvider> = {
  anthropic: new AnthropicProvider(),
  heuristic: new HeuristicProvider(),
};

export function listProviders(): AIProviderInfo[] {
  return Object.values(providers).map((p) => p.info());
}

/** First available provider in preference order (LLM first, heuristic as fallback). */
export function defaultProvider(): string {
  return providers.anthropic.info().available ? 'anthropic' : 'heuristic';
}

export async function planEdits(req: AIRequest, providerId = defaultProvider(), signal?: AbortSignal): Promise<AIPlan> {
  const provider = providers[providerId];
  if (!provider) throw new Error(`Unknown AI provider ${providerId}`);
  if (!provider.info().available) throw new Error(`${provider.info().label} is not available: ${provider.info().reason}`);
  const started = Date.now();
  const plan = await provider.plan(req, signal);
  return { ...plan, provider: providerId, durationMs: Date.now() - started };
}
