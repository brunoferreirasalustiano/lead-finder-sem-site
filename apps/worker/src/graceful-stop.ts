export function createGracefulStop() {
  let running = true;
  let wake: (() => void) | undefined;
  return {
    get running() { return running; },
    request() {
      running = false;
      wake?.();
      wake = undefined;
    },
    wait(milliseconds: number) {
      if (!running) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          wake = undefined;
          resolve();
        }, milliseconds);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    },
  };
}
