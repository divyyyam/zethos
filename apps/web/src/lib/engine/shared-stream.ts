import type { StreamFrame, StreamHandlers, Unsubscribe } from "@zethos/sdk";

/** Multiplex the SDK connection so the app shell and autonomous Agent share one socket. */
export function sharedStream(connect: (handlers: StreamHandlers) => Unsubscribe) {
  const listeners = new Set<StreamHandlers>();
  let disconnect: Unsubscribe | undefined;
  let connected = false;
  const dispatch = (frame: StreamFrame) => {
    for (const listener of listeners) {
      const handler = listener[frame.type] as ((frame: StreamFrame) => void) | undefined;
      handler?.(frame);
    }
  };
  return (handlers: StreamHandlers): Unsubscribe => {
    listeners.add(handlers);
    if (connected) handlers.onOpen?.();
    disconnect ??= connect({
      onOpen: () => {
        connected = true;
        for (const listener of listeners) listener.onOpen?.();
      },
      onClose: () => {
        connected = false;
        for (const listener of listeners) listener.onClose?.();
      },
      onError: (error) => {
        for (const listener of listeners) listener.onError?.(error);
      },
      price: dispatch,
      fill: dispatch,
      arena: dispatch,
      risk: dispatch,
      decision: dispatch,
      takerTier: dispatch,
      params: dispatch,
    });
    return () => {
      listeners.delete(handlers);
      if (!listeners.size) {
        disconnect?.();
        disconnect = undefined;
        connected = false;
      }
    };
  };
}
