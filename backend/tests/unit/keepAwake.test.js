import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepAwake } from '../../src/utils/keepAwake.js';

/** The server visits itself so Render's free plan never puts it to sleep. */
describe('keepAwake', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does nothing without a public address (on your computer)', () => {
    expect(keepAwake(undefined)).toBeNull();
  });

  it('asks its own public /health every 10 minutes', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetch);

    const timer = keepAwake('https://brightsmile-api.example.com');
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://brightsmile-api.example.com/health');
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(fetch).toHaveBeenCalledTimes(2);
    clearInterval(timer);
  });

  it('keeps going when a ping fails', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetch);

    const timer = keepAwake('https://brightsmile-api.example.com');
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
    expect(fetch).toHaveBeenCalledTimes(2);
    clearInterval(timer);
  });
});
