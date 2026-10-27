import { Controller, Get, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ResourcesController } from '../resources/resources.controller';
import { UserStatus } from '@tic/database';

@UseGuards(JwtAuthGuard)
@Controller('capacity')
export class CapacityController {
  constructor(private prisma: PrismaService) {}

  @Get('weekly')
  async getWeeklyCapacity() {
    const [resources, workingDaysParameter] = await Promise.all([
      this.prisma.resource.findMany({
      where: { status: UserStatus.ACTIVE },
      include: {
        modality: true,
        role: true,
      },
      }),
      this.prisma.globalParameter.findUnique({ where: { key: 'engine_working_days' } }),
    ]);
    let workingDayCount = 5;
    try {
      const parsed = JSON.parse(workingDaysParameter?.value || '[]');
      if (Array.isArray(parsed) && parsed.length) workingDayCount = new Set(parsed).size;
    } catch { workingDayCount = 5; }

    let totalWeeklyHours = 0;
    const items = resources.map((r) => {
      const cap = ResourcesController.calculateCapacity(r, workingDayCount);
      totalWeeklyHours += cap.weeklyProjCapacity;
      return {
        resourceId: r.id,
        resourceName: r.name,
        role: r.role.name,
        modality: r.modality.name,
        weeklyHours: r.weeklyHours,
        overhead: r.overheadPercentage,
        development: r.developmentPercentage,
        projectWeeklyCapacityHours: cap.weeklyProjCapacity,
        projectDailyCapacityHours: cap.dailyCapacity,
        weeklyFormatted: cap.weeklyFormatted,
        dailyFormatted: cap.dailyFormatted,
      };
    });

    return {
      totalResources: resources.length,
      totalWeeklyCapacityHours: totalWeeklyHours,
      totalWeeklyCapacityFormatted: ResourcesController.formatHours(totalWeeklyHours),
      resources: items,
    };
  }
}
