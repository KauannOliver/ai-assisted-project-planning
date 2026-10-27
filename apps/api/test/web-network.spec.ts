import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../../web/src/lib/api';

afterEach(() => { vi.unstubAllGlobals(); });

describe('browser API transport', () => {
  it('explains connection failures without retrying a login or deleting the session', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetch);
    const removeItem = vi.fn();
    vi.stubGlobal('localStorage', { removeItem });
    await expect(apiRequest('/auth/login', { method: 'POST', body: '{}' })).rejects.toMatchObject({ code: 'NETWORK_UNAVAILABLE', status: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(removeItem).not.toHaveBeenCalled();
  });
  it('handles an HTML gateway failure with a readable message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 })));
    await expect(apiRequest('/auth/login', { method: 'POST' })).rejects.toMatchObject({ status: 502, message: 'O serviço está temporariamente indisponível. Tente novamente em alguns instantes.' });
  });
  it('preserves explicit request cancellation', async () => {
    const abort = Object.assign(new Error('Cancelled'), { name: 'AbortError' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));
    await expect(apiRequest('/projects')).rejects.toBe(abort);
  });
});
