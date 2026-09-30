import crypto from 'node:crypto';
import type { Job, JobStep } from '@pixelforge/core';

const jobs = new Map<string, Job>();

export class JobHandle<T> {
  constructor(readonly job: Job<T>) {}

  step<R>(label: string, fn: () => Promise<R>): Promise<R> {
    const s: JobStep = { label, status: 'running' };
    this.job.steps.push(s);
    return fn().then(
      (r) => {
        s.status = 'done';
        return r;
      },
      (e) => {
        s.status = 'error';
        s.detail = e instanceof Error ? e.message : String(e);
        throw e;
      },
    );
  }

  note(detail: string) {
    const s = this.job.steps[this.job.steps.length - 1];
    if (s) s.detail = detail;
  }
}

export function startJob<T>(kind: string, run: (h: JobHandle<T>) => Promise<T>): Job<T> {
  const job: Job<T> = { id: crypto.randomBytes(6).toString('hex'), kind, status: 'running', steps: [], startedAt: Date.now() };
  jobs.set(job.id, job as Job);
  const handle = new JobHandle(job);
  run(handle).then(
    (result) => {
      job.result = result;
      job.status = 'done';
    },
    (e) => {
      job.error = e instanceof Error ? e.message : String(e);
      job.status = 'error';
      console.error(`[job ${kind}]`, e);
    },
  );
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}
