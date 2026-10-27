import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { Role, UserStatus } from '@tic/database';
import { UsersController } from '../../users/users.controller';

describe('user management permissions', () => {
  it('prevents a non-admin from creating an administrator', async () => {
    const prisma: any = {};
    const controller = new UsersController(prisma);
    await expect(controller.create(
      { user: { id: 'pm', role: Role.PROJECT_MANAGER } },
      { name: 'Admin', email: 'admin@example.com', role: Role.ADMIN, departmentIds: [] },
    )).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a non-admin to create a non-admin account', async () => {
    const created = { id: 'new-user', name: 'Novo', email: 'novo@example.com', role: Role.PROJECT_MANAGER };
    const tx: any = {
      user: { create: vi.fn().mockResolvedValue(created), findUnique: vi.fn().mockResolvedValue(created) },
      userDepartmentScope: { createMany: vi.fn() },
    };
    const prisma: any = {
      user: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: (callback: any) => callback(tx),
    };
    const controller = new UsersController(prisma);
    await controller.create(
      { user: { id: 'director', role: Role.DIRECTOR } },
      { name: 'Novo', email: 'NOVO@example.com', role: Role.PROJECT_MANAGER, departmentIds: [] },
    );
    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ email: 'novo@example.com', role: Role.PROJECT_MANAGER }) }));
  });

  it('soft deletes a user and records the responsible administrator', async () => {
    const target = { id: 'target', name: 'Usuário', email: 'u@example.com', role: Role.MANAGER, status: UserStatus.ACTIVE, deletedAt: null };
    const tx: any = {
      user: { update: vi.fn().mockResolvedValue(target) },
      businessEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma: any = {
      user: { findUnique: vi.fn().mockResolvedValue(target) },
      $transaction: (callback: any) => callback(tx),
    };
    const controller = new UsersController(prisma);
    await controller.remove('target', { user: { id: 'admin', name: 'Administrador', role: Role.ADMIN } });
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'target' },
      data: expect.objectContaining({ status: UserStatus.INACTIVE, deletedById: 'admin', deletedAt: expect.any(Date) }),
    }));
    expect(tx.businessEvent.create).toHaveBeenCalled();
  });
});
