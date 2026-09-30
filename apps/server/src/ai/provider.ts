import type { AIPlan, AIProviderInfo, AIRequest } from '@pixelforge/core';

/**
 * An AI provider turns a natural-language instruction plus a structured
 * snapshot of the selected subtree into a plan of edit operations. It
 * never touches the page or the source directly: plans are validated and
 * applied by the editor through the normal op/history pipeline.
 */
export interface AIProvider {
  info(): AIProviderInfo;
  plan(req: AIRequest, signal?: AbortSignal): Promise<Omit<AIPlan, 'provider' | 'durationMs'>>;
}
