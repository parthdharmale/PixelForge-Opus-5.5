/**
 * Typed postMessage RPC to the in-page agent living in an iframe. The
 * iframe may be cross-origin, so this is the only way the editor reads or
 * changes the page.
 */
import { PF_CHANNEL, isRpcMessage, type AgentEventName, type AgentEvents, type AgentMethod, type AgentMethods, type RpcMessage } from '@pixelforge/core';

type Listener<E extends AgentEventName> = (data: AgentEvents[E]) => void;

export class AgentBridge {
  private iframe: HTMLIFrameElement | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: number }>();
  private listeners = new Map<AgentEventName, Set<Listener<AgentEventName>>>();
  ready = false;

  constructor(readonly name: string) {
    window.addEventListener('message', this.onMessage);
  }

  attach(iframe: HTMLIFrameElement | null) {
    if (iframe === this.iframe) return;
    this.iframe = iframe;
    this.ready = false;
  }

  private onMessage = (e: MessageEvent) => {
    if (!this.iframe || e.source !== this.iframe.contentWindow || !isRpcMessage(e.data)) return;
    const msg = e.data as RpcMessage;
    if (msg.kind === 'response') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.result);
    } else if (msg.kind === 'event') {
      if (msg.event === 'ready') this.ready = true;
      this.listeners.get(msg.event)?.forEach((l) => l(msg.data as never));
    }
  };

  call<M extends AgentMethod>(method: M, params: Parameters<AgentMethods[M]>[0], timeout = 8000): Promise<ReturnType<AgentMethods[M]>> {
    const win = this.iframe?.contentWindow;
    if (!win || !this.ready) return Promise.reject(new Error('Page is not ready'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Agent call ${method} timed out`));
      }, timeout);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      win.postMessage({ channel: PF_CHANNEL, kind: 'request', id, method, params }, '*');
    });
  }

  on<E extends AgentEventName>(event: E, fn: Listener<E>): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn as Listener<AgentEventName>);
    return () => set!.delete(fn as Listener<AgentEventName>);
  }
}

export const editorBridge = new AgentBridge('editor');
export const originalBridge = new AgentBridge('original');
