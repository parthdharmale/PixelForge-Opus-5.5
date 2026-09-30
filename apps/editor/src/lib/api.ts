import type { AIPlan, AIProviderInfo, AIRequest, EditState, Job, OpenUrlResponse, PatchResult, ProjectStatus, VerificationReport, VerifyViewport } from '@pixelforge/core';

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  health: () => req<{ ok: boolean; ai: { providers: AIProviderInfo[]; default: string } }>('GET', '/health'),
  fixtures: () => req<Array<{ name: string; path: string }>>('GET', '/fixtures'),
  openUrl: (url: string) => req<OpenUrlResponse>('POST', '/session/open', { url }),
  openProject: (body: { demo?: boolean; path?: string; devUrl?: string }) => req<ProjectStatus>('POST', '/projects', body),
  project: (id: string) => req<ProjectStatus & { logs: string[] }>('GET', `/projects/${id}`),
  resetDemo: (id: string) => req<ProjectStatus>('POST', `/projects/${id}/reset`),
  codegenSource: (id: string, state: EditState, sharedClass: Record<string, boolean>) => req<PatchResult>('POST', `/projects/${id}/codegen`, { state, sharedClass }),
  codegenUrl: (pageUrl: string, state: EditState) => req<PatchResult>('POST', '/url/codegen', { pageUrl, state }),
  apply: (id: string, patchId: string, verify: boolean, pagePath: string, viewports?: VerifyViewport[]) =>
    req<{ jobId?: string; files?: string[] }>('POST', `/projects/${id}/apply`, { patchId, verify, pagePath, viewports }),
  revert: (id: string, patchId: string) => req<{ files: string[] }>('POST', `/projects/${id}/revert`, { patchId }),
  job: (id: string) => req<Job<VerificationReport>>('GET', `/jobs/${id}`),
  aiPlan: (request: AIRequest, provider?: string) => req<AIPlan>('POST', '/ai/plan', { request, provider }),
};
