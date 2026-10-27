import { 
  Controller, 
  Get, 
  Post, 
  Patch, 
  Delete, 
  Body, 
  Param, 
  Query,
  UseGuards, 
  BadRequestException, 
  ForbiddenException,
  Req 
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { IsNotEmpty, IsString, IsOptional, IsDateString } from 'class-validator';

class CreateDeliveryDto {
  @IsString()
  @IsNotEmpty()
  recipientDeptId: string;

  @IsDateString()
  deliveryDate: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  plannedDeliveryId?: string;
}

class UpdateDeliveryDto {
  @IsOptional()
  @IsString()
  recipientDeptId?: string;

  @IsOptional()
  @IsDateString()
  deliveryDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  plannedDeliveryId?: string;
}

class CreatePlannedDeliveryDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  recipientDeptId: string;

  @IsDateString()
  plannedDate: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class UpdatePlannedDeliveryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @IsOptional()
  @IsString()
  recipientDeptId?: string;

  @IsOptional()
  @IsDateString()
  plannedDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class CreateFeedbackDto {
  @IsDateString()
  feedbackDate: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class UpdateFeedbackDto {
  @IsOptional()
  @IsDateString()
  feedbackDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class DeliveriesController {
  constructor(private prisma: PrismaService) {}

  private civilDate(value: string, fieldLabel: string): Date {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
    if (!match) throw new BadRequestException(`${fieldLabel} inválida.`);
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) {
      throw new BadRequestException(`${fieldLabel} inválida.`);
    }
    return date;
  }

  private dateKey(value: Date) {
    return value.toISOString().slice(0, 10);
  }

  private async assertFeedbackAccess(client: any, user: any, recipientDeptId: string) {
    if (user.role === 'ADMIN' || user.role === 'PROJECT_MANAGER') return;
    const scope = await client.userDepartmentScope.findFirst({
      where: { userId: user.id, departmentId: recipientDeptId },
      select: { id: true },
    });
    if (!scope) throw new ForbiddenException('Você não possui acesso ao departamento destinatário desta entrega.');
  }

  private async validatePlannedDelivery(client: any, projectId: string, plannedDeliveryId?: string | null, currentDeliveryId?: string) {
    if (!plannedDeliveryId) return null;
    const planned = await client.plannedDelivery.findUnique({ where: { id: plannedDeliveryId }, include: { delivery: { select: { id: true } } } });
    if (!planned || planned.projectId !== projectId) {
      throw new BadRequestException('A entrega planejada selecionada não pertence a este projeto.');
    }
    if (planned.delivery && planned.delivery.id !== currentDeliveryId) {
      throw new BadRequestException('Esta entrega planejada já está vinculada a outra entrega realizada.');
    }
    return planned;
  }

  @Get('projects/:id/planned-deliveries')
  async getPlannedDeliveries(@Param('id') projectId: string) {
    return this.prisma.plannedDelivery.findMany({
      where: { projectId },
      include: {
        recipientDept: { select: { id: true, code: true, name: true } },
        delivery: { select: { id: true, deliveryDate: true } },
      },
      orderBy: [{ plannedDate: 'asc' }, { createdAt: 'asc' }],
    });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post('projects/:id/planned-deliveries')
  async createPlannedDelivery(@Param('id') projectId: string, @Req() req: any, @Body() body: CreatePlannedDeliveryDto) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true, sdNumber: true } });
    if (!project) throw new BadRequestException('Projeto não encontrado.');
    return this.prisma.$transaction(async tx => {
      const planned = await tx.plannedDelivery.create({
        data: {
          projectId, title: body.title.trim(), recipientDeptId: body.recipientDeptId,
          plannedDate: this.civilDate(body.plannedDate, 'Data planejada'), notes: body.notes?.trim() || null,
          createdById: req.user.id,
        },
        include: { recipientDept: true, delivery: true },
      });
      await tx.businessEvent.create({ data: {
        aggregateType: 'PLANNED_DELIVERY', aggregateId: planned.id, eventType: 'PLANNED_DELIVERY_CREATED',
        description: `Entrega planejada “${planned.title}” criada para a SD ${project.sdNumber}.`,
        userId: req.user.id, actorName: req.user.name,
        metadata: { projectId, sdNumber: project.sdNumber, plannedDate: this.dateKey(planned.plannedDate), recipientDeptId: planned.recipientDeptId, recipientDeptCode: planned.recipientDept.code },
      } });
      return planned;
    });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Patch('planned-deliveries/:id')
  async updatePlannedDelivery(@Param('id') id: string, @Req() req: any, @Body() body: UpdatePlannedDeliveryDto) {
    const planned = await this.prisma.plannedDelivery.findUnique({ where: { id }, include: { project: true, recipientDept: true } });
    if (!planned) throw new BadRequestException('Entrega planejada não encontrada.');
    return this.prisma.$transaction(async tx => {
      const updated = await tx.plannedDelivery.update({
        where: { id },
        data: {
          title: body.title !== undefined ? body.title.trim() : undefined,
          recipientDeptId: body.recipientDeptId,
          plannedDate: body.plannedDate ? this.civilDate(body.plannedDate, 'Data planejada') : undefined,
          notes: body.notes !== undefined ? (body.notes.trim() || null) : undefined,
        },
        include: { recipientDept: true, delivery: true },
      });
      await tx.businessEvent.create({ data: {
        aggregateType: 'PLANNED_DELIVERY', aggregateId: id, eventType: 'PLANNED_DELIVERY_UPDATED',
        description: `Entrega planejada “${updated.title}” da SD ${planned.project.sdNumber} atualizada.`,
        userId: req.user.id, actorName: req.user.name,
        metadata: {
          projectId: planned.projectId, sdNumber: planned.project.sdNumber,
          before: { title: planned.title, recipientDeptId: planned.recipientDeptId, recipientDeptCode: planned.recipientDept.code, plannedDate: this.dateKey(planned.plannedDate), notes: planned.notes },
          after: { title: updated.title, recipientDeptId: updated.recipientDeptId, recipientDeptCode: updated.recipientDept.code, plannedDate: this.dateKey(updated.plannedDate), notes: updated.notes },
        },
      } });
      return updated;
    });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Delete('planned-deliveries/:id')
  async deletePlannedDelivery(@Param('id') id: string, @Req() req: any) {
    const planned = await this.prisma.plannedDelivery.findUnique({
      where: { id }, include: { project: true, recipientDept: true, delivery: { select: { id: true } } },
    });
    if (!planned) throw new BadRequestException('Entrega planejada não encontrada.');
    await this.prisma.$transaction(async tx => {
      await tx.plannedDelivery.delete({ where: { id } });
      await tx.businessEvent.create({ data: {
        aggregateType: 'PLANNED_DELIVERY', aggregateId: id, eventType: 'PLANNED_DELIVERY_DELETED',
        description: `Entrega planejada “${planned.title}” da SD ${planned.project.sdNumber} removida.`,
        userId: req.user.id, actorName: req.user.name,
        metadata: {
          projectId: planned.projectId, sdNumber: planned.project.sdNumber,
          unlinkedDeliveriesCount: planned.delivery ? 1 : 0,
          before: { title: planned.title, recipientDeptId: planned.recipientDeptId, recipientDeptCode: planned.recipientDept.code, plannedDate: this.dateKey(planned.plannedDate), notes: planned.notes },
        },
      } });
    });
    return { success: true, unlinkedDeliveriesCount: planned.delivery ? 1 : 0 };
  }

  @Get('projects/:id/deliveries')
  async getDeliveries(@Param('id') projectId: string) {
    return this.prisma.delivery.findMany({
      where: { projectId },
      include: {
        recipientDept: { select: { id: true, code: true, name: true } },
        plannedDelivery: { select: { id: true, title: true, plannedDate: true, recipientDeptId: true } },
        feedback: true,
      },
      orderBy: { deliveryDate: 'desc' },
    });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post('projects/:id/deliveries')
  async createDelivery(
    @Param('id') projectId: string,
    @Req() req: any,
    @Body() body: CreateDeliveryDto,
  ) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new BadRequestException('Projeto não encontrado.');
    await this.validatePlannedDelivery(this.prisma, projectId, body.plannedDeliveryId);

    const delivery = await this.prisma.delivery.create({
      data: {
        projectId,
        recipientDeptId: body.recipientDeptId,
        deliveryDate: this.civilDate(body.deliveryDate, 'Data da entrega'),
        notes: body.notes,
        plannedDeliveryId: body.plannedDeliveryId || null,
        createdById: req.user.id,
      },
      include: { recipientDept: true, plannedDelivery: true },
    });

    // Record BusinessEvent
    await this.prisma.businessEvent.create({
      data: {
        aggregateType: 'DELIVERY',
        aggregateId: delivery.id,
        eventType: 'DELIVERY_CREATED',
        description: `Entrega criada para o projeto ${project.sdNumber} destinada ao departamento ${delivery.recipientDept.code}.`,
        userId: req.user.id,
        metadata: { projectId, sdNumber: project.sdNumber },
      },
    });

    return delivery;
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Patch('deliveries/:id')
  async updateDelivery(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: UpdateDeliveryDto,
  ) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id },
      include: { project: true, recipientDept: true, plannedDelivery: true },
    });
    if (!delivery) throw new BadRequestException('Entrega não encontrada.');
    if (body.plannedDeliveryId !== undefined) await this.validatePlannedDelivery(this.prisma, delivery.projectId, body.plannedDeliveryId || null, id);

    const deliveryDate = body.deliveryDate ? this.civilDate(body.deliveryDate, 'Data da entrega') : delivery.deliveryDate;
    const existingFeedback = await this.prisma.deliveryFeedback.findUnique({ where: { deliveryId: id } });
    if (existingFeedback && deliveryDate.getTime() > existingFeedback.feedbackDate.getTime()) {
      throw new BadRequestException('A data da entrega não pode ser posterior à data da devolutiva.');
    }

    const updated = await this.prisma.$transaction(async tx => {
      const result = await tx.delivery.update({
        where: { id },
        data: {
          recipientDeptId: body.recipientDeptId || delivery.recipientDeptId,
          deliveryDate,
          notes: body.notes !== undefined ? (body.notes.trim() || null) : delivery.notes,
          plannedDeliveryId: body.plannedDeliveryId !== undefined ? (body.plannedDeliveryId || null) : delivery.plannedDeliveryId,
        },
        include: { recipientDept: true, feedback: true, plannedDelivery: true },
      });
      await tx.businessEvent.create({
        data: {
          aggregateType: 'DELIVERY', aggregateId: id, eventType: 'DELIVERY_UPDATED',
          description: `Entrega da SD ${delivery.project.sdNumber} atualizada.`, userId: req.user.id, actorName: req.user.name,
          metadata: {
            projectId: delivery.projectId, sdNumber: delivery.project.sdNumber,
            before: { recipientDeptId: delivery.recipientDeptId, recipientDeptCode: delivery.recipientDept.code, deliveryDate: this.dateKey(delivery.deliveryDate), notes: delivery.notes, plannedDeliveryId: delivery.plannedDeliveryId },
            after: { recipientDeptId: result.recipientDeptId, recipientDeptCode: result.recipientDept.code, deliveryDate: this.dateKey(result.deliveryDate), notes: result.notes, plannedDeliveryId: result.plannedDeliveryId },
          },
        },
      });
      return result;
    });

    return updated;
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Delete('deliveries/:id')
  async deleteDelivery(@Param('id') id: string, @Req() req: any) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id },
      include: { project: true, recipientDept: true, feedback: true },
    });
    if (!delivery) throw new BadRequestException('Entrega não encontrada.');

    await this.prisma.$transaction(async tx => {
      await tx.delivery.delete({ where: { id } });
      await tx.businessEvent.create({
        data: {
          aggregateType: 'DELIVERY',
          aggregateId: id,
          eventType: 'DELIVERY_DELETED',
          description: `Entrega da SD ${delivery.project.sdNumber} destinada a ${delivery.recipientDept.code} removida${delivery.feedback ? ' junto com sua devolutiva' : ''}.`,
          userId: req.user.id,
          actorName: req.user.name,
          metadata: {
            projectId: delivery.projectId,
            sdNumber: delivery.project.sdNumber,
            deletedFeedback: !!delivery.feedback,
            before: {
              recipientDeptId: delivery.recipientDeptId,
              recipientDeptCode: delivery.recipientDept.code,
              deliveryDate: this.dateKey(delivery.deliveryDate),
              notes: delivery.notes,
              feedback: delivery.feedback ? {
                id: delivery.feedback.id,
                feedbackDate: this.dateKey(delivery.feedback.feedbackDate),
                notes: delivery.feedback.notes,
              } : null,
            },
          },
        },
      });
    });

    return { success: true, deletedFeedback: !!delivery.feedback };
  }

  @Post('deliveries/:id/feedback')
  async createFeedback(
    @Param('id') deliveryId: string,
    @Req() req: any,
    @Body() body: CreateFeedbackDto,
  ) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: { feedback: true, project: true },
    });

    if (!delivery) throw new BadRequestException('Entrega não encontrada.');
    await this.assertFeedbackAccess(this.prisma, req.user, delivery.recipientDeptId);
    if (delivery.feedback) throw new BadRequestException('Esta entrega já possui uma devolutiva registrada.');

    const fbDate = this.civilDate(body.feedbackDate, 'Data da devolutiva');
    if (fbDate.getTime() < new Date(delivery.deliveryDate).getTime()) {
      throw new BadRequestException('A data da devolutiva não pode ser anterior à data de entrega.');
    }

    const feedback = await this.prisma.deliveryFeedback.create({
      data: {
        deliveryId,
        feedbackDate: fbDate,
        notes: body.notes,
        createdById: req.user.id,
      },
    });

    await this.prisma.businessEvent.create({
      data: {
        aggregateType: 'DELIVERY',
        aggregateId: deliveryId,
        eventType: 'DELIVERY_FEEDBACK_CREATED',
        description: `Devolutiva registrada para a entrega da SD ${delivery.project.sdNumber}.`,
        userId: req.user.id,
        metadata: { projectId: delivery.projectId, sdNumber: delivery.project.sdNumber },
      },
    });

    return feedback;
  }

  @Patch('deliveries/:id/feedback')
  async updateFeedback(
    @Param('id') deliveryId: string,
    @Req() req: any,
    @Body() body: UpdateFeedbackDto,
  ) {
    const feedback = await this.prisma.deliveryFeedback.findUnique({
      where: { deliveryId },
      include: { delivery: { include: { project: true } } },
    });

    if (!feedback) throw new BadRequestException('Devolutiva não encontrada.');
    await this.assertFeedbackAccess(this.prisma, req.user, feedback.delivery.recipientDeptId);

    const feedbackDate = body.feedbackDate ? this.civilDate(body.feedbackDate, 'Data da devolutiva') : feedback.feedbackDate;
    if (feedbackDate.getTime() < feedback.delivery.deliveryDate.getTime()) {
      throw new BadRequestException('A data da devolutiva não pode ser anterior à data da entrega.');
    }

    const updated = await this.prisma.$transaction(async tx => {
      const result = await tx.deliveryFeedback.update({
        where: { deliveryId },
        data: { feedbackDate, notes: body.notes !== undefined ? (body.notes.trim() || null) : feedback.notes },
      });
      await tx.businessEvent.create({
        data: {
          aggregateType: 'DELIVERY', aggregateId: deliveryId, eventType: 'DELIVERY_FEEDBACK_UPDATED',
          description: `Devolutiva da entrega da SD ${feedback.delivery.project.sdNumber} atualizada.`, userId: req.user.id, actorName: req.user.name,
          metadata: {
            projectId: feedback.delivery.projectId, sdNumber: feedback.delivery.project.sdNumber,
            before: { feedbackDate: this.dateKey(feedback.feedbackDate), notes: feedback.notes },
            after: { feedbackDate: this.dateKey(result.feedbackDate), notes: result.notes },
          },
        },
      });
      return result;
    });

    return updated;
  }

  @Delete('deliveries/:id/feedback')
  async deleteFeedback(
    @Param('id') deliveryId: string,
    @Req() req: any,
  ) {
    const feedback = await this.prisma.deliveryFeedback.findUnique({
      where: { deliveryId },
      include: { delivery: { include: { project: true, recipientDept: true } } },
    });
    if (!feedback) throw new BadRequestException('Devolutiva não encontrada.');
    await this.assertFeedbackAccess(this.prisma, req.user, feedback.delivery.recipientDeptId);

    await this.prisma.$transaction(async tx => {
      await tx.deliveryFeedback.delete({ where: { deliveryId } });
      await tx.businessEvent.create({
        data: {
          aggregateType: 'DELIVERY',
          aggregateId: deliveryId,
          eventType: 'DELIVERY_FEEDBACK_DELETED',
          description: `Devolutiva da entrega da SD ${feedback.delivery.project.sdNumber} removida. A entrega voltou a ficar pendente.`,
          userId: req.user.id,
          actorName: req.user.name,
          metadata: {
            projectId: feedback.delivery.projectId,
            sdNumber: feedback.delivery.project.sdNumber,
            recipientDeptId: feedback.delivery.recipientDeptId,
            recipientDeptCode: feedback.delivery.recipientDept.code,
            before: { feedbackDate: this.dateKey(feedback.feedbackDate), notes: feedback.notes },
          },
        },
      });
    });

    return { success: true };
  }

  @Get('deliveries/pending')
  async getPendingDeliveries(@Req() req: any) {
    const user = req.user;
    const isRestricted = user.role === 'MANAGER' || user.role === 'DIRECTOR';

    let filterClause: any = { feedback: null };

    if (isRestricted) {
      const scopes = await this.prisma.userDepartmentScope.findMany({
        where: { userId: user.id },
        select: { departmentId: true },
      });
      const allowedDepts = scopes.map(s => s.departmentId);

      filterClause.recipientDeptId = { in: allowedDepts };
    }

    const pending = await this.prisma.delivery.findMany({
      where: filterClause,
      include: {
        project: { select: { id: true, sdNumber: true, title: true } },
        recipientDept: { select: { id: true, code: true, name: true } },
        plannedDelivery: { select: { id: true, title: true, plannedDate: true } },
      },
      orderBy: { deliveryDate: 'asc' },
    });

    const now = new Date().getTime();

    return pending.map(d => {
      const daysElapsed = Math.floor((now - new Date(d.deliveryDate).getTime()) / (1000 * 60 * 60 * 24));
      return {
        id: d.id,
        projectId: d.projectId,
        sdNumber: d.project.sdNumber,
        projectTitle: d.project.title,
        recipientDeptCode: d.recipientDept.code,
        deliveryDate: d.deliveryDate,
        notes: d.notes,
        daysWaiting: Math.max(0, daysElapsed),
      };
    });
  }

  @Get('deliveries/all')
  async getAllDeliveries(
    @Req() req: any,
    @Query('departmentId') departmentId?: string,
    @Query('completion') completion: 'ALL' | 'COMPLETED' | 'PENDING' = 'ALL',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    if (!['ALL', 'COMPLETED', 'PENDING'].includes(completion)) {
      throw new BadRequestException('Situação da entrega inválida.');
    }
    const start = startDate ? this.civilDate(startDate, 'Data inicial') : null;
    const end = endDate ? this.civilDate(endDate, 'Data final') : null;
    if (start && end && start.getTime() > end.getTime()) {
      throw new BadRequestException('A data inicial não pode ser posterior à data final.');
    }

    const isRestricted = req.user.role === 'MANAGER' || req.user.role === 'DIRECTOR';
    let allowedDepartmentIds: string[] | null = null;
    if (isRestricted) {
      const scopes = await this.prisma.userDepartmentScope.findMany({ where: { userId: req.user.id }, select: { departmentId: true } });
      allowedDepartmentIds = scopes.map(scope => scope.departmentId);
    }
    if (departmentId && allowedDepartmentIds && !allowedDepartmentIds.includes(departmentId)) return [];

    const where: any = {};
    if (departmentId) where.recipientDeptId = departmentId;
    else if (allowedDepartmentIds) where.recipientDeptId = { in: allowedDepartmentIds };
    if (completion === 'COMPLETED') where.feedback = { isNot: null };
    if (completion === 'PENDING') where.feedback = { is: null };
    if (start || end) where.deliveryDate = {
      ...(start ? { gte: start } : {}),
      ...(end ? { lte: end } : {}),
    };

    return this.prisma.delivery.findMany({
      where,
      include: {
        project: { select: { id: true, sdNumber: true, title: true } },
        recipientDept: { select: { id: true, code: true, name: true } },
        feedback: true,
        plannedDelivery: { select: { id: true, title: true, plannedDate: true } },
      },
      orderBy: [{ deliveryDate: 'desc' }, { createdAt: 'desc' }],
    });
  }

  @Get('deliveries/metrics')
  async getMetrics(@Req() req: any) {
    const user = req.user;
    const isRestricted = user.role === 'MANAGER' || user.role === 'DIRECTOR';

    let deptFilter: any = {};
    if (isRestricted) {
      const scopes = await this.prisma.userDepartmentScope.findMany({
        where: { userId: user.id },
        select: { departmentId: true },
      });
      const allowedDepts = scopes.map(s => s.departmentId);
      deptFilter.id = { in: allowedDepts };
    }

    const departments = await this.prisma.department.findMany({
      where: deptFilter,
      include: {
        deliveries: {
          include: { feedback: true },
        },
      },
    });

    return departments.map(d => {
      const deliveries = d.deliveries;
      const totalDeliveries = deliveries.length;
      const totalWithFeedback = deliveries.filter(del => !!del.feedback).length;
      const totalPending = totalDeliveries - totalWithFeedback;

      // Calculate feedback time diffs
      const diffs = deliveries
        .filter(del => !!del.feedback)
        .map(del => {
          const start = new Date(del.deliveryDate).getTime();
          const end = new Date(del.feedback!.feedbackDate).getTime();
          return Math.max(0, Math.floor((end - start) / (1000 * 60 * 60 * 24)));
        });

      const avgResponseDays = diffs.length > 0 
        ? parseFloat((diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(1))
        : 0;

      const minResponseDays = diffs.length > 0 ? Math.min(...diffs) : 0;
      const maxResponseDays = diffs.length > 0 ? Math.max(...diffs) : 0;

      return {
        departmentId: d.id,
        departmentCode: d.code,
        departmentName: d.name,
        totalDeliveries,
        totalWithFeedback,
        totalPending,
        avgResponseDays,
        minResponseDays,
        maxResponseDays,
      };
    });
  }
}
