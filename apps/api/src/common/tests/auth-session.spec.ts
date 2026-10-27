import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';

describe('authenticated session guard', () => {
  it('preserves database outages instead of expiring a valid session', async () => {
    const databaseError = Object.assign(new Error('database system is in recovery mode'), { code: 'P1001' });
    const guard = new JwtAuthGuard(
      { verify: vi.fn().mockReturnValue({ userId: 'u1', tokenVersion: 0 }) } as any,
      { user: { findUnique: vi.fn().mockRejectedValue(databaseError) } } as any,
    );
    await expect(guard.canActivate({ switchToHttp: () => ({ getRequest: () => ({ cookies: { jwt_token: 'token' } }) }) } as any)).rejects.toBe(databaseError);
  });

  it('rejects expired tokens without querying the database', async () => {
    const findUnique = vi.fn();
    const guard = new JwtAuthGuard(
      { verify: vi.fn(() => { throw new Error('jwt expired'); }) } as any,
      { user: { findUnique } } as any,
    );
    await expect(guard.canActivate({ switchToHttp: () => ({ getRequest: () => ({ cookies: { jwt_token: 'token' } }) }) } as any)).rejects.toMatchObject({ response: { code: 'INVALID_TOKEN' } });
    expect(findUnique).not.toHaveBeenCalled();
  });
  it('exposes token expiration to the client', async () => {
    const request: any = { cookies: { jwt_token: 'token' }, path: '/auth/me' };
    const guard = new JwtAuthGuard(
      { verify: vi.fn().mockReturnValue({ userId: 'u1', tokenVersion: 0, exp: 1_800_000_000 }) } as any,
      { user: { findUnique: vi.fn().mockResolvedValue({ id: 'u1', name: 'U', email: 'u@e.com', role: 'MANAGER', status: 'ACTIVE', tokenVersion: 0, forcePasswordChange: false, deletedAt: null }) } } as any,
    );
    await expect(guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as any)).resolves.toBe(true);
    expect(request.user.expiresAt).toBe(new Date(1_800_000_000 * 1000).toISOString());
  });

  it('preserves the password-change response instead of converting it to an invalid token', async () => {
    const request: any = { cookies: { jwt_token: 'token' }, path: '/projects' };
    const guard = new JwtAuthGuard(
      { verify: vi.fn().mockReturnValue({ userId: 'u1', tokenVersion: 0, exp: 1_800_000_000 }) } as any,
      { user: { findUnique: vi.fn().mockResolvedValue({ id: 'u1', name: 'U', email: 'u@e.com', role: 'MANAGER', status: 'ACTIVE', tokenVersion: 0, forcePasswordChange: true, deletedAt: null }) } } as any,
    );
    await expect(guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as any)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
