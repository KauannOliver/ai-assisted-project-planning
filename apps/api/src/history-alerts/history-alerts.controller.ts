import { 
  Controller, 
  Get, 
  Param, 
  UseGuards, 
  Req 
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Role, UserStatus } from '@prisma/client';
import { humanizeBusinessEventDescription, humanizeBusinessEventLabel } from './business-events.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class HistoryAlertsController {
  constructor(private prisma: PrismaService) {}

  private async getDepartmentAllowedIds(user: any): Promise<string[] | null> {
    if (user.role === Role.MANAGER || user.role === Role.DIRECTOR) {
      const scopes = await this.prisma.userDepartmentScope.findMany({
        where: { userId: user.id },
        select: { departmentId: true },
      });
      return scopes.map(s => s.departmentId);
    }
    return null;
  }

  @Get('projects/:id/history')
  async getProjectHistory(@Param('id') projectId: string, @Req() req: any) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, include: { departments: true } });
    if (!project) return [];

    const allowed = await this.getDepartmentAllowedIds(req.user);
    if (allowed && !project.departments.some(d => allowed.includes(d.departmentId))) return [];

    const events = await this.prisma.businessEvent.findMany({
      where: {
        OR: [
          { aggregateType: 'PROJECT', aggregateId: projectId },
          { aggregateType: 'DELIVERY', metadata: { path: ['projectId'], equals: projectId } },
          { aggregateType: 'PLANNED_DELIVERY', metadata: { path: ['projectId'], equals: projectId } }
        ]
      },
      orderBy: { createdAt: 'desc' }, include: { user: { select: { id: true, name: true } } },
    });
    return events.map(e => ({
      ...e,
      displayLabel: humanizeBusinessEventLabel(e.eventType),
      description: humanizeBusinessEventDescription(e),
    }));
  }

  @Get('history/recent')
  async getRecentHistory(@Req() req: any) {
    const user = req.user;
    const allowedDepts = await this.getDepartmentAllowedIds(user);

    let filterClause: any = {};
    if (allowedDepts) {
      // Find project IDs that belong to the manager departments
      const projects = await this.prisma.project.findMany({
        where: {
          departments: { some: { departmentId: { in: allowedDepts } } }
        },
        select: { id: true }
      });
      const projIds = projects.map(p => p.id);

      filterClause = {
        OR: [
          { aggregateType: 'PROJECT', aggregateId: { in: projIds } },
          { aggregateType: 'DELIVERY', metadata: { path: ['projectId'], in: projIds } },
          { aggregateType: 'PLANNED_DELIVERY', metadata: { path: ['projectId'], in: projIds } },
          { aggregateType: 'MEETING' }
        ]
      };
    }

    const events = await this.prisma.businessEvent.findMany({
      where: filterClause,
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { user: { select: { id: true, name: true } } },
    });
    return events.map(e => ({
      ...e,
      displayLabel: humanizeBusinessEventLabel(e.eventType),
      description: humanizeBusinessEventDescription(e),
    }));
  }

  @Get('alerts')
  async getActiveAlerts(@Req() req: any) {
    const user = req.user;
    const allowedDepts = await this.getDepartmentAllowedIds(user);

    const alerts: any[] = [];

    // Filter projects based on department scopes
    let projFilter: any = { status: { notIn: [7, 8, 9] } };
    if (allowedDepts) {
      projFilter.departments = {
        some: { departmentId: { in: allowedDepts } }
      };
    }

    const projects = await this.prisma.project.findMany({
      where: projFilter,
      include: {
        currentSchedule: true,
        departments: { include: { department: true } }
      }
    });

    const projIds = projects.map(p => p.id);

    // Rule 1: Iniciado sem comitê
    for (const p of projects) {
      if (p.status === 5 && p.committeeDecision !== 'PRIORIZADO') {
        alerts.push({
          type: 'NO_COMMITTEE_APPROVAL',
          severity: 'CRITICAL',
          projectId: p.id,
          sdNumber: p.sdNumber,
          projectTitle: p.title,
          department: p.departments.map(d => d.department.code).join(','),
          message: `O projeto ${p.sdNumber} foi iniciado e está em Processo de Software, mas não possui parecer aprovado (Priorizado) no comitê diretivo.`,
          detectedAt: p.updatedAt,
        });
      }
    }

    // Rule 2 & 3: Prazo em Risco e Atrasado
    for (const p of projects) {
      if (p.currentSchedule) {
        if (p.currentSchedule.status === 'AT_RISK') {
          alerts.push({
            type: 'DEADLINE_AT_RISK',
            severity: 'WARNING',
            projectId: p.id,
            sdNumber: p.sdNumber,
            projectTitle: p.title,
            department: p.departments.map(d => d.department.code).join(','),
            message: `O projeto ${p.sdNumber} tem a conclusão prevista muito próxima ou no limite do prazo solicitado.`,
            detectedAt: p.currentSchedule.updatedAt,
          });
        } else if (p.currentSchedule.status === 'DELAYED') {
          alerts.push({
            type: 'DEADLINE_DELAYED',
            severity: 'CRITICAL',
            projectId: p.id,
            sdNumber: p.sdNumber,
            projectTitle: p.title,
            department: p.departments.map(d => d.department.code).join(','),
            message: `O projeto ${p.sdNumber} está com a entrega prevista posterior ao prazo solicitado.`,
            detectedAt: p.currentSchedule.updatedAt,
          });
        }
      }
    }

    // Rule 4: Entrega sem devolutiva
    let delFilter: any = { feedback: null };
    if (allowedDepts) {
      delFilter.recipientDeptId = { in: allowedDepts };
    }
    const pendingDeliveries = await this.prisma.delivery.findMany({
      where: delFilter,
      include: {
        project: true,
        recipientDept: true
      }
    });

    const now = new Date().getTime();
    for (const d of pendingDeliveries) {
      const diffDays = Math.max(0, Math.floor((now - new Date(d.deliveryDate).getTime()) / (1000 * 60 * 60 * 24)));
      alerts.push({
        type: 'DELIVERY_PENDING_FEEDBACK',
        severity: 'WARNING',
        projectId: d.projectId,
        sdNumber: d.project.sdNumber,
        projectTitle: d.project.title,
        department: d.recipientDept.code,
        message: `Entrega da SD ${d.project.sdNumber} está aguardando devolutiva há ${diffDays} dias corridos.`,
        detectedAt: d.deliveryDate,
      });
    }

    // Rule 5 & 6: Recurso sobrecarregado e Fase sem recurso (from engine warnings)
    let warningFilter: any = {};
    if (allowedDepts) {
      warningFilter.projectId = { in: projIds };
    }
    const dbWarnings = await this.prisma.currentEngineWarning.findMany({
      where: warningFilter,
    });

    for (const w of dbWarnings) {
      if (w.type === 'WIP_OVERLOAD') {
        const res = await this.prisma.resource.findUnique({ where: { id: w.resourceId! } });
        alerts.push({
          type: 'RESOURCE_OVERLOAD',
          severity: 'WARNING',
          resourceId: w.resourceId,
          resourceName: res?.name || 'Recurso',
          message: w.message,
          detectedAt: w.createdAt,
        });
      } else if (w.type === 'PHASE_NO_RESOURCE') {
        const proj = projects.find(p => p.id === w.projectId);
        if (proj) {
          alerts.push({
            type: 'PHASE_NO_RESOURCE',
            severity: 'CRITICAL',
            projectId: w.projectId,
            sdNumber: proj.sdNumber,
            projectTitle: proj.title,
            message: w.message,
            detectedAt: w.createdAt,
          });
        }
      }
    }

    return alerts;
  }

  @Get('alerts/counts')
  async getAlertsCounts(@Req() req: any) {
    const alerts = await this.getActiveAlerts(req);
    const critical = alerts.filter(a => a.severity === 'CRITICAL').length;
    const warning = alerts.filter(a => a.severity === 'WARNING').length;

    return {
      total: alerts.length,
      critical,
      warning,
    };
  }
}
