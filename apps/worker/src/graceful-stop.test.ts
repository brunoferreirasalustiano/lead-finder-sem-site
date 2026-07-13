import { describe, expect, it } from 'vitest';
import { createGracefulStop } from './graceful-stop.js';

describe('graceful stop', () => {
  it('stops new work and interrupts polling without a long sleep', async () => {
    const stop = createGracefulStop();
    const waiting = stop.wait(60_000);
    stop.request();
    await waiting;
    expect(stop.running).toBe(false);
  });
});
