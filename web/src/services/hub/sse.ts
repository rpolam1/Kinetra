export interface SseMessage {
  event: string;
  data: string;
  id: string | null;
}

/** Splits a stream of text into server sent events. A chunk can end part way through an event, so unfinished text is kept for the next chunk. */
export class SseParser {
  private buffer = '';

  push(chunk: string): SseMessage[] {
    this.buffer += chunk.replace(/\r\n?/g, '\n');
    const messages: SseMessage[] = [];
    let end = this.buffer.indexOf('\n\n');
    while (end !== -1) {
      const block = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const message = parseBlock(block);
      if (message) messages.push(message);
      end = this.buffer.indexOf('\n\n');
    }
    return messages;
  }
}

/** Read one event block. Comment lines are skipped, and a block with no data gives null. */
function parseBlock(block: string): SseMessage | null {
  let event = 'message';
  let id: string | null = null;
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
    else if (field === 'id') id = value;
  }
  return data.length === 0 ? null : { event, data: data.join('\n'), id };
}

export type StreamState = 'connecting' | 'open' | 'reconnecting' | 'unauthorized' | 'closed';

export interface StreamOptions {
  url: string;
  headers?: () => Record<string, string>;
  onMessage: (message: SseMessage) => void;
  onState?: (state: StreamState) => void;
  fetchImpl?: typeof fetch;
  minDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** Wait for a time, finishing early if the stream is closed. */
function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Open a server sent event stream and reconnect with a growing delay when it drops. A 401 stops it, because retrying with the same key cannot work. Returns a function that closes it. */
export function openStream(options: StreamOptions): () => void {
  const controller = new AbortController();
  // The fetch API is used instead of EventSource because EventSource cannot send the API key header
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const sleep = options.sleep ?? defaultSleep;
  const minDelay = options.minDelayMs ?? 500;
  const maxDelay = options.maxDelayMs ?? 8000;
  const setState = (s: StreamState) => options.onState?.(s);

  void (async () => {
    let delay = minDelay;
    let first = true;
    while (!controller.signal.aborted) {
      setState(first ? 'connecting' : 'reconnecting');
      first = false;
      try {
        const response = await fetchImpl(options.url, {
          headers: { Accept: 'text/event-stream', ...(options.headers?.() ?? {}) },
          signal: controller.signal,
        });
        if (response.status === 401) {
          setState('unauthorized');
          return;
        }
        if (!response.ok || !response.body) throw new Error(`stream failed (${response.status})`);
        setState('open');
        delay = minDelay;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const parser = new SseParser();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const message of parser.push(decoder.decode(value, { stream: true }))) options.onMessage(message);
        }
      } catch {
        if (controller.signal.aborted) break;
      }
      if (controller.signal.aborted) break;
      setState('reconnecting');
      await sleep(delay, controller.signal);
      delay = Math.min(delay * 2, maxDelay);
    }
    setState('closed');
  })();

  return () => controller.abort();
}
