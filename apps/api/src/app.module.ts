import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersController } from './users/users.controller';
import { DepartmentsController } from './departments/departments.controller';
import { CatalogsController } from './catalogs/catalogs.controller';
import { ParametersController } from './parameters/parameters.controller';
import { ResourcesController } from './resources/resources.controller';
import { UnavailabilitiesController } from './unavailabilities/unavailabilities.controller';
import { CapacityController } from './capacity/capacity.controller';
import { ProjectsController } from './projects/projects.controller';
import { PriorityQueueController } from './priority-queue/priority-queue.controller';
import { CommitteeController } from './committee/committee.controller';
import { ScheduleController } from './schedule/schedule.controller';
import { DeliveriesController } from './deliveries/deliveries.controller';
import { DashboardsController } from './dashboards/dashboards.controller';
import { ImportsExportsController } from './imports-exports/imports-exports.controller';
import { HistoryAlertsController } from './history-alerts/history-alerts.controller';
import { AppController } from './app.controller';
import { EngineService } from './engine/engine.service';
import { BusinessEventsService } from './history-alerts/business-events.service';
import { AiNarrativeController } from './ai/ai-narrative.controller';
import { AiNarrativeService } from './ai/ai-narrative.service';
import { BiController } from './bi/bi.controller';
import { BiApiKeyGuard } from './bi/bi-api-key.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
  ],
  controllers: [
    AppController,
    UsersController,
    DepartmentsController,
    CatalogsController,
    ParametersController,
    ResourcesController,
    UnavailabilitiesController,
    CapacityController,
    ProjectsController,
    PriorityQueueController,
    CommitteeController,
    ScheduleController,
    DeliveriesController,
    DashboardsController,
    ImportsExportsController,
    HistoryAlertsController,
    AiNarrativeController,
    BiController,
  ],
  providers: [
    EngineService,
    BusinessEventsService,
    AiNarrativeService,
    BiApiKeyGuard,
  ],
})
export class AppModule {}
