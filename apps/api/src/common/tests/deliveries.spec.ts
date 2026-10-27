import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DeliveriesController } from '../../deliveries/deliveries.controller';

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe('edição de entregas e devolutivas', () => {
  it('cria uma entrega planejada com data civil e auditoria', async () => {
    const plannedCreate = vi.fn().mockResolvedValue({
      id: 'planned-1', projectId: 'project-1', title: 'Protótipo', recipientDeptId: 'dept-1',
      plannedDate: date('2026-09-10'), notes: 'Validar', recipientDept: { code: 'TIC' }, delivery: null,
    });
    const eventCreate = vi.fn();
    const prisma: any = {
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-1', sdNumber: '123' }) },
      $transaction: vi.fn(async (callback: any) => callback({ plannedDelivery: { create: plannedCreate }, businessEvent: { create: eventCreate } })),
    };
    const controller = new DeliveriesController(prisma);
    const result = await controller.createPlannedDelivery('project-1', { user: { id: 'admin', name: 'Administrador' } }, {
      title: 'Protótipo', recipientDeptId: 'dept-1', plannedDate: '2026-09-10', notes: 'Validar',
    });
    expect(result.id).toBe('planned-1');
    expect(plannedCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ plannedDate: date('2026-09-10') }) }));
    expect(eventCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventType: 'PLANNED_DELIVERY_CREATED' }) }));
  });

  it('impede vincular uma entrega realizada ao planejamento de outro projeto', async () => {
    const prisma: any = {
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-1', sdNumber: '123' }) },
      plannedDelivery: { findUnique: vi.fn().mockResolvedValue({ id: 'planned-1', projectId: 'project-2', delivery: null }) },
    };
    const controller = new DeliveriesController(prisma);
    await expect(controller.createDelivery('project-1', { user: { id: 'admin' } }, {
      recipientDeptId: 'dept-1', deliveryDate: '2026-09-10', plannedDeliveryId: 'planned-1',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('edita a entrega e registra antes/depois na mesma transação', async () => {
    const original = {
      id: 'delivery-1', projectId: 'project-1', recipientDeptId: 'dept-1', deliveryDate: date('2026-08-01'), notes: 'Anterior',
      project: { sdNumber: '123' }, recipientDept: { code: 'TIC' },
    };
    const updated = { ...original, recipientDeptId: 'dept-2', deliveryDate: date('2026-08-02'), notes: 'Corrigida', recipientDept: { code: 'COM' }, feedback: null };
    const eventCreate = vi.fn();
    const prisma: any = {
      delivery: { findUnique: vi.fn().mockResolvedValue(original) },
      deliveryFeedback: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (callback: any) => callback({ delivery: { update: vi.fn().mockResolvedValue(updated) }, businessEvent: { create: eventCreate } })),
    };
    const controller = new DeliveriesController(prisma);
    const result = await controller.updateDelivery('delivery-1', { user: { id: 'admin', name: 'Administrador' } }, { recipientDeptId: 'dept-2', deliveryDate: '2026-08-02', notes: 'Corrigida' });
    expect(result).toEqual(updated);
    expect(eventCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventType: 'DELIVERY_UPDATED', metadata: expect.objectContaining({ before: expect.any(Object), after: expect.any(Object) }) }) }));
  });

  it('impede mover uma entrega para depois da devolutiva existente', async () => {
    const prisma: any = {
      delivery: { findUnique: vi.fn().mockResolvedValue({ id: 'delivery-1', projectId: 'project-1', recipientDeptId: 'dept-1', deliveryDate: date('2026-08-01'), notes: null, project: { sdNumber: '123' }, recipientDept: { code: 'TIC' } }) },
      deliveryFeedback: { findUnique: vi.fn().mockResolvedValue({ feedbackDate: date('2026-08-05') }) },
    };
    const controller = new DeliveriesController(prisma);
    await expect(controller.updateDelivery('delivery-1', { user: { id: 'admin' } }, { deliveryDate: '2026-08-06' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('edita uma devolutiva preservando a ordem cronológica e auditando a mudança', async () => {
    const original = { id: 'feedback-1', deliveryId: 'delivery-1', feedbackDate: date('2026-08-05'), notes: 'Anterior', delivery: { projectId: 'project-1', deliveryDate: date('2026-08-01'), project: { sdNumber: '123' } } };
    const updated = { ...original, feedbackDate: date('2026-08-06'), notes: 'Corrigida' };
    const eventCreate = vi.fn();
    const prisma: any = {
      deliveryFeedback: { findUnique: vi.fn().mockResolvedValue(original) },
      $transaction: vi.fn(async (callback: any) => callback({ deliveryFeedback: { update: vi.fn().mockResolvedValue(updated) }, businessEvent: { create: eventCreate } })),
    };
    const controller = new DeliveriesController(prisma);
    const result = await controller.updateFeedback('delivery-1', { user: { id: 'admin', name: 'Administrador', role: 'ADMIN' } }, { feedbackDate: '2026-08-06', notes: 'Corrigida' });
    expect(result).toEqual(updated);
    expect(eventCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventType: 'DELIVERY_FEEDBACK_UPDATED', metadata: expect.objectContaining({ before: expect.any(Object), after: expect.any(Object) }) }) }));
  });

  it('exclui uma entrega e sua devolutiva juntas dentro da mesma transação', async () => {
    const delivery = {
      id: 'delivery-1', projectId: 'project-1', recipientDeptId: 'dept-1', deliveryDate: date('2026-08-01'), notes: 'Entrega',
      project: { sdNumber: '123' }, recipientDept: { code: 'TIC' },
      feedback: { id: 'feedback-1', feedbackDate: date('2026-08-05'), notes: 'Devolutiva' },
    };
    const deleteDelivery = vi.fn();
    const eventCreate = vi.fn();
    const prisma: any = {
      delivery: { findUnique: vi.fn().mockResolvedValue(delivery) },
      $transaction: vi.fn(async (callback: any) => callback({ delivery: { delete: deleteDelivery }, businessEvent: { create: eventCreate } })),
    };
    const controller = new DeliveriesController(prisma);

    const result = await controller.deleteDelivery('delivery-1', { user: { id: 'admin', name: 'Administrador', role: 'ADMIN' } });

    expect(result).toEqual({ success: true, deletedFeedback: true });
    expect(deleteDelivery).toHaveBeenCalledWith({ where: { id: 'delivery-1' } });
    expect(eventCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventType: 'DELIVERY_DELETED', metadata: expect.objectContaining({ deletedFeedback: true }) }) }));
  });

  it('exclui somente a devolutiva e mantém a entrega pendente', async () => {
    const feedback = {
      id: 'feedback-1', deliveryId: 'delivery-1', feedbackDate: date('2026-08-05'), notes: 'Parecer',
      delivery: { projectId: 'project-1', recipientDeptId: 'dept-1', project: { sdNumber: '123' }, recipientDept: { code: 'TIC' } },
    };
    const deleteFeedback = vi.fn();
    const eventCreate = vi.fn();
    const prisma: any = {
      deliveryFeedback: { findUnique: vi.fn().mockResolvedValue(feedback) },
      $transaction: vi.fn(async (callback: any) => callback({ deliveryFeedback: { delete: deleteFeedback }, businessEvent: { create: eventCreate } })),
    };
    const controller = new DeliveriesController(prisma);

    await expect(controller.deleteFeedback('delivery-1', { user: { id: 'admin', name: 'Administrador', role: 'ADMIN' } })).resolves.toEqual({ success: true });
    expect(deleteFeedback).toHaveBeenCalledWith({ where: { deliveryId: 'delivery-1' } });
    expect(eventCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventType: 'DELIVERY_FEEDBACK_DELETED' }) }));
  });

  it('combina departamento, situação e período usando datas civis inclusivas', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma: any = { delivery: { findMany } };
    const controller = new DeliveriesController(prisma);

    await controller.getAllDeliveries(
      { user: { id: 'admin', role: 'ADMIN' } },
      'dept-1', 'PENDING', '2026-08-01', '2026-08-31',
    );

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        recipientDeptId: 'dept-1',
        feedback: { is: null },
        deliveryDate: { gte: date('2026-08-01'), lte: date('2026-08-31') },
      },
    }));
  });

  it('impede excluir devolutiva fora do escopo departamental do usuário', async () => {
    const prisma: any = {
      deliveryFeedback: { findUnique: vi.fn().mockResolvedValue({
        deliveryId: 'delivery-1', feedbackDate: date('2026-08-05'), notes: null,
        delivery: { projectId: 'project-1', recipientDeptId: 'dept-1', project: { sdNumber: '123' }, recipientDept: { code: 'TIC' } },
      }) },
      userDepartmentScope: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const controller = new DeliveriesController(prisma);

    await expect(controller.deleteFeedback('delivery-1', { user: { id: 'manager', role: 'MANAGER' } })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
