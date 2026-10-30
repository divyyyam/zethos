import { ZethosError } from "./errors.js";
import { streamFrame } from "./schemas.js";
import type { StreamFrame, StreamFrameType } from "./types.js";

export type FrameHandlers = {
  [K in StreamFrameType]?: (frame: Extract<StreamFrame, { type: K }>) => void;
};

export interface StreamHandlers extends FrameHandlers {
  onOpen?: () => void;
  onClose?: () => void;
  /** Frames that are not JSON or do not match the wire contract. The stream keeps running. */
  onError?: (error: ZethosError) => void;
}

export type Unsubscribe = () => void;

export interface SubscribeOptions {
  url: string;
  WebSocket: typeof WebSocket;
  handlers: StreamHandlers;
  minDelayMs?: number;
  maxDelayMs?: number;
}

export function backoffDelay(attempt: number, minDelayMs = 500, maxDelayMs = 15_000): number {
  return Math.min(maxDelayMs, minDelayMs * 2 ** attempt);
}

/** Opens the stream and reconnects with exponential backoff until unsubscribed. */
export function subscribe({
  url,
  WebSocket: Socket,
  handlers,
  minDelayMs = 500,
  maxDelayMs = 15_000,
}: SubscribeOptions): Unsubscribe {
  let socket: WebSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let stopped = false;

  const connect = () => {
    socket = new Socket(url);
    socket.onopen = () => {
      attempt = 0;
      handlers.onOpen?.();
    };
    socket.onmessage = (event) => dispatch(event.data, handlers);
    socket.onclose = () => {
      handlers.onClose?.();
      if (stopped) return;
      timer = setTimeout(connect, backoffDelay(attempt, minDelayMs, maxDelayMs));
      attempt += 1;
    };
  };

  connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    socket?.close();
  };
}

function dispatch(data: unknown, handlers: StreamHandlers): void {
  let json: unknown;
  try {
    json = JSON.parse(String(data));
  } catch {
    handlers.onError?.(new ZethosError("invalid_response", "Stream frame is not JSON"));
    return;
  }
  const parsed = streamFrame.safeParse(json);
  if (!parsed.success) {
    handlers.onError?.(
      new ZethosError("invalid_response", "Stream frame does not match the wire contract", 0, {
        frame: json,
        issues: parsed.error.issues,
      }),
    );
    return;
  }
  const handler = handlers[parsed.data.type] as ((frame: StreamFrame) => void) | undefined;
  handler?.(parsed.data);
}

export function streamUrl(engineUrl: string): string {
  return `${engineUrl.replace(/^http/, "ws")}/stream`;
}
