// UI updates have their own serialized queue. A slow icon must never block a
// subsequent appearance decision; keep only the latest pending presentation.
export function createPresentationQueue({ apply, onError }) {
  let pending;
  let running = false;
  let completedKey;
  let idle = Promise.resolve();
  return {
    request(value) {
      pending = value;
      if (!running) {
        running = true;
        idle = Promise.resolve().then(async () => {
          try {
            while (pending) {
              const next = pending;
              pending = undefined;
              if (next.key === completedKey) continue;
              try {
                await apply(next);
                completedKey = next.key;
              }
              catch (error) {
                completedKey = undefined;
                onError(error);
              }
            }
          }
          finally { running = false; }
        });
      }
      return idle;
    },
    whenIdle() { return idle; },
  };
}
