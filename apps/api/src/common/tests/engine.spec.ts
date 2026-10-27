import { describe, it, expect } from 'vitest';
import { EngineService, EngineProject, EngineResource, EngineHoliday } from '../../engine/engine.service';

describe('EngineService Unit Tests', () => {
  const service = new EngineService(null as any);

  it('should identify weekends correctly', () => {
    // 2026-08-01 is Saturday, 2026-08-02 is Sunday, 2026-08-03 is Monday
    const sat = new Date('2026-08-01T00:00:00Z');
    const sun = new Date('2026-08-02T00:00:00Z');
    const mon = new Date('2026-08-03T00:00:00Z');

    expect(service.isWeekend(sat)).toBe(true);
    expect(service.isWeekend(sun)).toBe(true);
    expect(service.isWeekend(mon)).toBe(false);
  });

  it('should respect the configured productive weekdays', () => {
    const resource: EngineResource = {
      id: 'r-days', name: 'Calendário', weeklyHours: 40, overheadPercentage: 0,
      developmentPercentage: 1, recommendedWipLimit: 3, unavailabilities: [],
    };
    const friday = new Date('2026-08-07T00:00:00Z');
    const saturday = new Date('2026-08-08T00:00:00Z');
    const configuredDays = [1, 2, 3, 4, 5];

    expect(service.getResourceCapacityOnDate(friday, resource, [], new Map(), { workingDays: configuredDays })).toBe(480);
    expect(service.getResourceCapacityOnDate(saturday, resource, [], new Map(), { workingDays: configuredDays })).toBe(0);
  });

  it('should identify global holidays correctly, including annual recurrences', () => {
    const holidays: EngineHoliday[] = [
      { startDate: new Date('2026-09-07T00:00:00Z'), endDate: new Date('2026-09-07T00:00:00Z'), annualRecurrence: true }, // Independência
      { startDate: new Date('2026-12-25T00:00:00Z'), endDate: new Date('2026-12-25T00:00:00Z'), annualRecurrence: true }, // Natal
      { startDate: new Date('2026-05-01T00:00:00Z'), endDate: new Date('2026-05-01T00:00:00Z'), annualRecurrence: false }, // Worker Day (one-time test date)
    ];

    // Sept 7 on a different year (e.g. 2028-09-07) should be identified as a holiday due to annualRecurrence
    const sept7_2028 = new Date('2028-09-07T12:00:00Z');
    expect(service.isGlobalHoliday(sept7_2028, holidays)).toBe(true);

    // May 1 on a different year should NOT be identified as a holiday since annualRecurrence is false
    const may1_2028 = new Date('2028-05-01T00:00:00Z');
    expect(service.isGlobalHoliday(may1_2028, holidays)).toBe(false);

    // May 1 on 2026 should be a holiday
    const may1_2026 = new Date('2026-05-01T00:00:00Z');
    expect(service.isGlobalHoliday(may1_2026, holidays)).toBe(true);

    const yearEndBreak: EngineHoliday[] = [{ startDate: new Date('2026-12-24T00:00:00Z'), endDate: new Date('2027-01-02T00:00:00Z'), annualRecurrence: true }];
    expect(service.isGlobalHoliday(new Date('2028-12-26T00:00:00Z'), yearEndBreak)).toBe(true);
    expect(service.isGlobalHoliday(new Date('2029-01-02T00:00:00Z'), yearEndBreak)).toBe(true);
  });

  it('should calculate base daily capacity in minutes correctly', () => {
    // 40 hours weekly, 10% overhead, 80% development allocation
    // base capacity = (40 * 0.9 * 0.8) / 5 = 5.76 hours/day = 345.6 mins -> 346 minutes rounded
    const res = {
      weeklyHours: 40,
      overheadPercentage: 0.1,
      developmentPercentage: 0.8,
    };

    const mins = service.calculateBaseDailyCapacity(res);
    expect(mins).toBe(346);
  });

  it('should sort the projects queue according to the governance rules', async () => {
    const proj1: EngineProject = {
      id: 'p1',
      sdNumber: 'SD-001',
      title: 'Legal Requirement Project',
      requester: 'Legal',
      totalHours: 10,
      status: 2,
      isLegalRequirement: true,
      businessPriorityCode: 'media',
      committeeDecision: 'NAO_AVALIADO',
      committeeScore: 0,
      openingDate: new Date('2026-01-10T00:00:00Z'),
      requestedDeadline: null,
      phases: [],
    };

    const proj2: EngineProject = {
      id: 'p2',
      sdNumber: 'SD-002',
      title: 'Prioritized High Score Project',
      requester: 'Marketing',
      totalHours: 10,
      status: 5,
      isLegalRequirement: false,
      businessPriorityCode: 'alta',
      committeeDecision: 'PRIORIZADO',
      committeeScore: 9.5,
      openingDate: new Date('2026-01-15T00:00:00Z'),
      requestedDeadline: null,
      phases: [],
    };

    const proj3: EngineProject = {
      id: 'p3',
      sdNumber: 'SD-003',
      title: 'Second Phase Project',
      requester: 'Sales',
      totalHours: 10,
      status: 4,
      isLegalRequirement: false,
      businessPriorityCode: 'media',
      committeeDecision: 'SEGUNDA_FASE',
      committeeScore: 8.0,
      openingDate: new Date('2026-01-05T00:00:00Z'),
      requestedDeadline: null,
      phases: [],
    };

    const queue = [proj3, proj2, proj1];
    const sorted = await service.sortFilaAutomatic(queue);

    // Rule: Legal Requirement goes absolute first (proj1)
    expect(sorted[0].id).toBe('p1');
    // Rule: Decision prioritizing (Prioritado proj2 > Segunda Fase proj3)
    expect(sorted[1].id).toBe('p2');
    expect(sorted[2].id).toBe('p3');
  });

  it('should simulate timeline and detect WIP limits and end dates', () => {
    const resources: EngineResource[] = [
      {
        id: 'r1',
        name: 'Alice',
        weeklyHours: 40,
        overheadPercentage: 0,
        developmentPercentage: 1, // 8h/day = 480 mins
        recommendedWipLimit: 1,
        unavailabilities: [],
      },
    ];

    const projects: EngineProject[] = [
      {
        id: 'p1',
        sdNumber: 'SD-001',
        title: 'Project 1',
        requester: 'IT',
        totalHours: 16, // 16h = 960 minutes -> takes exactly 2 working days
        status: 1,
        isLegalRequirement: false,
        businessPriorityCode: 'alta',
        committeeDecision: 'PRIORIZADO',
        committeeScore: 10,
        openingDate: new Date('2026-08-03T00:00:00Z'), // Monday
        requestedDeadline: null,
        phases: [
          {
            id: 'ph1',
            phaseId: 'phase-dev',
            name: 'Desenvolvimento',
            percentage: 100,
            order: 1,
            totalMinutes: 960,
            executionMode: 'SIMULTANEOUS',
            allocations: [
              { id: 'al1', resourceId: 'r1', minutesAllocated: 960, order: 1 }
            ]
          }
        ]
      }
    ];

    const holidays: EngineHoliday[] = [];
    const startCalcDate = new Date('2026-08-03T00:00:00Z'); // Monday

    const result = service.simulateAllocationSchedule(
      projects,
      resources,
      holidays,
      'automatic',
      [],
      projects, // auto sorted list is same
      'all_eligible',
      startCalcDate
    );

    expect(result.projects[0].isImpeded).toBe(false);
    // Project starts on Aug 3 and takes 2 working days (Aug 3 and Aug 4)
    expect(result.projects[0].startDate?.toISOString().split('T')[0]).toBe('2026-08-03');
    expect(result.projects[0].endDate?.toISOString().split('T')[0]).toBe('2026-08-04');
    expect(result.portfolioEndDate?.toISOString().split('T')[0]).toBe('2026-08-04');
  });

  it('should ignore legacy phase progress and derive remaining work from the project status', () => {
    const resource: EngineResource = { id: 'r1', name: 'Alice', weeklyHours: 40, overheadPercentage: 0, developmentPercentage: 1, recommendedWipLimit: 3, unavailabilities: [] };
    const project: EngineProject = {
      id: 'p-progress', sdNumber: 'SD-PROGRESS', title: 'Projeto com progresso', requester: 'TI', totalHours: 16,
      status: 5, isLegalRequirement: false, businessPriorityCode: 'alta', committeeDecision: 'PRIORIZADO', committeeScore: 10,
      openingDate: new Date('2026-08-03T00:00:00Z'), requestedDeadline: null,
      phases: [{ id: 'ph-progress', phaseId: 'dev', name: 'Desenvolvimento', percentage: 100, order: 1, totalMinutes: 960, completedMinutes: 480, status: 'IN_PROGRESS' as any, executionMode: 'SIMULTANEOUS', allocations: [{ id: 'al-progress', resourceId: 'r1', minutesAllocated: 960, order: 1 }] }],
    };
    const result = service.simulateAllocationSchedule([project], [resource], [], 'automatic', [], [project], 'all_eligible', new Date('2026-08-03T00:00:00Z'));
    expect(result.allocations.reduce((sum, allocation) => sum + allocation.minutesAllocated, 0)).toBe(960);
    expect(result.projects[0].endDate?.toISOString().split('T')[0]).toBe('2026-08-04');
  });

  it('should never exceed the resource daily net capacity', () => {
    const resource: EngineResource = { id: 'r1', name: 'Alice', weeklyHours: 20, overheadPercentage: 0, developmentPercentage: 1, recommendedWipLimit: 3, unavailabilities: [] };
    const project: EngineProject = {
      id: 'p-cap', sdNumber: 'SD-CAP', title: 'Capacidade rígida', requester: 'TI', totalHours: 12,
      status: 5, isLegalRequirement: false, businessPriorityCode: 'alta', committeeDecision: 'PRIORIZADO', committeeScore: 10,
      openingDate: new Date('2026-08-03T00:00:00Z'), requestedDeadline: null,
      phases: [{ id: 'ph-cap', phaseId: 'dev', name: 'Desenvolvimento', percentage: 100, order: 1, totalMinutes: 720, executionMode: 'SIMULTANEOUS', allocations: [{ id: 'al-cap', resourceId: 'r1', minutesAllocated: 720, order: 1 }] }],
    };
    const result = service.simulateAllocationSchedule([project], [resource], [], 'automatic', [], [project], 'all_eligible', new Date('2026-08-03T00:00:00Z'));
    const daily = new Map<string, number>();
    result.allocations.forEach(allocation => { const date = allocation.date.toISOString().split('T')[0]; daily.set(date, (daily.get(date) || 0) + allocation.minutesAllocated); });
    expect(Math.max(...daily.values())).toBeLessThanOrEqual(240);
    expect(result.projects[0].endDate?.toISOString().split('T')[0]).toBe('2026-08-05');
  });

  it('suspends the forecast when allocation weights diverge from phase effort', () => {
    const resources: EngineResource[] = [
      { id: 'r-weight-1', name: 'Peso 1', weeklyHours: 40, overheadPercentage: 0, developmentPercentage: 1, recommendedWipLimit: 3, unavailabilities: [] },
      { id: 'r-weight-2', name: 'Peso 2', weeklyHours: 40, overheadPercentage: 0, developmentPercentage: 1, recommendedWipLimit: 3, unavailabilities: [] },
    ];
    const project: EngineProject = {
      id: 'p-weight', sdNumber: 'SD-WEIGHT', title: 'Pesos inconsistentes', requester: 'TI', totalHours: 10,
      status: 5, isLegalRequirement: false, businessPriorityCode: 'alta', committeeDecision: 'PRIORIZADO', committeeScore: 10,
      openingDate: new Date('2026-08-03T00:00:00Z'), requestedDeadline: null,
      phases: [{ id: 'phase-weight', phaseId: 'dev', name: 'Desenvolvimento', percentage: 100, order: 1, totalMinutes: 600, executionMode: 'SIMULTANEOUS', allocations: [
        { id: 'weight-a1', resourceId: 'r-weight-1', minutesAllocated: 600, order: 1 },
        { id: 'weight-a2', resourceId: 'r-weight-2', minutesAllocated: 600, order: 2 },
      ] }],
    };

    const result = service.simulateAllocationSchedule([project], resources, [], 'automatic', [], [project], 'all_eligible', new Date('2026-08-03T00:00:00Z'));
    expect(result.allocations).toHaveLength(0);
    expect(result.projects[0]).toMatchObject({ isImpeded: true, endDate: null });
    expect(result.warnings.some(w => w.type === 'PROJECT_EFFORT_INCONSISTENT')).toBe(true);
  });

  it('should respect manual order even when a legal project is placed last', () => {
    const resource: EngineResource = { id: 'r1', name: 'Alice', weeklyHours: 40, overheadPercentage: 0, developmentPercentage: 1, recommendedWipLimit: 3, unavailabilities: [] };
    const makeProject = (id: string, legal: boolean): EngineProject => ({
      id, sdNumber: id, title: id, requester: 'TI', totalHours: 1, status: 5, isLegalRequirement: legal,
      businessPriorityCode: 'alta', committeeDecision: 'PRIORIZADO', committeeScore: 10, openingDate: new Date('2026-08-03T00:00:00Z'), requestedDeadline: null,
      phases: [{ id: `ph-${id}`, phaseId: 'dev', name: 'Desenvolvimento', percentage: 100, order: 1, totalMinutes: 60, executionMode: 'SIMULTANEOUS', allocations: [{ id: `al-${id}`, resourceId: 'r1', minutesAllocated: 60, order: 1 }] }],
    });
    const normal = makeProject('normal', false); const legal = makeProject('legal', true);
    const result = service.simulateAllocationSchedule([normal, legal], [resource], [], 'manual', ['normal', 'legal'], [legal, normal], 'all_eligible', new Date('2026-08-03T00:00:00Z'));
    expect(result.projects.map(project => project.projectId)).toEqual(['normal', 'legal']);
    expect(result.projects.find(project => project.projectId === 'legal')?.queuePosition).toBe(2);
  });

  it('should account management hours without blocking delivery while respecting vacations', () => {
    const manager: EngineResource = {
      id: 'manager', name: 'Líder', weeklyHours: 80, overheadPercentage: 0, developmentPercentage: 1,
      recommendedWipLimit: 1,
      unavailabilities: [{ type: 'VACATION' as any, startDate: new Date('2026-08-03T00:00:00Z'), endDate: new Date('2026-08-07T00:00:00Z'), unavailableMinutesPerDay: null }],
    };
    const developer: EngineResource = {
      id: 'developer', name: 'Dev', weeklyHours: 40, overheadPercentage: 0, developmentPercentage: 1,
      recommendedWipLimit: 3, unavailabilities: [],
    };
    const makeProject = (id: string): EngineProject => ({
      id, sdNumber: id, title: id, requester: 'TI', totalHours: 16, status: 1,
      isLegalRequirement: false, businessPriorityCode: 'alta', committeeDecision: 'PRIORIZADO', committeeScore: 10,
      openingDate: new Date('2026-08-03T00:00:00Z'), requestedDeadline: null,
      phases: [
        { id: `gp-${id}`, phaseId: 'gp', name: 'Gestão de Projetos', percentage: 50, order: 1, totalMinutes: 480, executionMode: 'SIMULTANEOUS', allocations: [{ id: `gp-a-${id}`, resourceId: 'manager', minutesAllocated: 480, order: 1 }] },
        { id: `dev-${id}`, phaseId: 'dev', name: 'Desenvolvimento', percentage: 50, order: 2, totalMinutes: 480, executionMode: 'SIMULTANEOUS', allocations: [{ id: `dev-a-${id}`, resourceId: 'developer', minutesAllocated: 480, order: 1 }] },
      ],
    });
    const projects = [makeProject('P1'), makeProject('P2')];
    const result = service.simulateAllocationSchedule(projects, [manager, developer], [], 'automatic', [], projects, 'all_eligible', new Date('2026-08-03T00:00:00Z'), 'hard');

    const managementAllocations = result.allocations.filter(allocation => allocation.resourceId === 'manager');
    expect(managementAllocations.reduce((sum, allocation) => sum + allocation.minutesAllocated, 0)).toBe(960);
    expect(managementAllocations.every(allocation => allocation.date.toISOString().startsWith('2026-08-10'))).toBe(true);
    expect(result.phases.filter(phase => phase.projectPhaseId.startsWith('dev-')).map(phase => phase.startDate?.toISOString().split('T')[0])).toEqual(['2026-08-03', '2026-08-04']);
    expect(result.warnings.some(warning => warning.type === 'WIP_OVERLOAD' && warning.resourceId === 'manager')).toBe(false);
  });

  it('should share the physical daily ceiling between management and delivery work', () => {
    const resource: EngineResource = {
      id: 'leader-dev', name: 'Líder técnico', weeklyHours: 40, overheadPercentage: 0,
      developmentPercentage: 1, recommendedWipLimit: 3, unavailabilities: [],
    };
    const project: EngineProject = {
      id: 'mixed', sdNumber: 'SD-MIXED', title: 'Gestão e execução', requester: 'TI', totalHours: 16,
      status: 1, isLegalRequirement: false, businessPriorityCode: 'alta', committeeDecision: 'PRIORIZADO', committeeScore: 10,
      openingDate: new Date('2026-08-03T00:00:00Z'), requestedDeadline: null,
      phases: [
        { id: 'mixed-gp', phaseId: 'gp', name: 'Gestão de Projetos', percentage: 50, order: 1, totalMinutes: 480, executionMode: 'SIMULTANEOUS', allocations: [{ id: 'mixed-gp-a', resourceId: resource.id, minutesAllocated: 480, order: 1 }] },
        { id: 'mixed-dev', phaseId: 'dev', name: 'Desenvolvimento', percentage: 50, order: 2, totalMinutes: 480, executionMode: 'SIMULTANEOUS', allocations: [{ id: 'mixed-dev-a', resourceId: resource.id, minutesAllocated: 480, order: 1 }] },
      ],
    };
    const result = service.simulateAllocationSchedule([project], [resource], [], 'automatic', [], [project], 'all_eligible', new Date('2026-08-03T00:00:00Z'));
    const daily = new Map<string, number>();
    result.allocations.forEach(allocation => {
      const date = allocation.date.toISOString().split('T')[0];
      daily.set(date, (daily.get(date) || 0) + allocation.minutesAllocated);
    });

    expect(Math.max(...daily.values())).toBeLessThanOrEqual(480);
    expect(result.phases.find(phase => phase.projectPhaseId === 'mixed-dev')?.startDate?.toISOString().startsWith('2026-08-03')).toBe(true);
    expect(result.projects[0].endDate?.toISOString().startsWith('2026-08-03')).toBe(true);
  });

  it.each([
    { status: 0, expected: ['Gestão de Projetos', 'Levantamento', 'Arquitetura', 'Design', 'Desenvolvimento', 'Qualidade', 'Entrega/Aplicação', 'Homologação', 'Golive'] },
    { status: 1, expected: ['Gestão de Projetos', 'Levantamento', 'Arquitetura', 'Design', 'Desenvolvimento', 'Qualidade', 'Entrega/Aplicação', 'Homologação', 'Golive'] },
    { status: 2, expected: ['Gestão de Projetos', 'Levantamento', 'Arquitetura', 'Design', 'Desenvolvimento', 'Qualidade', 'Entrega/Aplicação', 'Homologação', 'Golive'] },
    { status: 4, expected: ['Arquitetura', 'Design', 'Desenvolvimento', 'Qualidade', 'Entrega/Aplicação', 'Homologação', 'Golive'] },
    { status: 5, expected: ['Design', 'Desenvolvimento', 'Qualidade', 'Entrega/Aplicação', 'Homologação', 'Golive'] },
    { status: 6, expected: ['Homologação', 'Golive'] },
  ])('should select the remaining phases from overall status $status', ({ status, expected }) => {
    const resource: EngineResource = { id: 'r-status', name: 'Especialista', weeklyHours: 80, overheadPercentage: 0, developmentPercentage: 1, recommendedWipLimit: 20, unavailabilities: [] };
    const names = ['Gestão de Projetos', 'Levantamento', 'Arquitetura', 'Design', 'Desenvolvimento', 'Qualidade', 'Entrega/Aplicação', 'Homologação', 'Golive'];
    const project: EngineProject = {
      id: `p-status-${status}`, sdNumber: `SD-${status}`, title: 'Fases remanescentes', requester: 'TI', totalHours: 9,
      status, isLegalRequirement: false, businessPriorityCode: 'alta', committeeDecision: 'PRIORIZADO', committeeScore: 10,
      openingDate: new Date('2026-08-03T00:00:00Z'), requestedDeadline: null,
      phases: names.map((name, index) => ({
        id: `phase-${status}-${index}`, phaseId: `catalog-${index}`, name, percentage: 100 / names.length, order: index + 1,
        totalMinutes: 60, executionMode: 'SIMULTANEOUS', allocations: [{ id: `allocation-${status}-${index}`, resourceId: resource.id, minutesAllocated: 60, order: 1 }],
      })),
    };

    const result = service.simulateAllocationSchedule([project], [resource], [], 'automatic', [], [project], 'all_eligible', new Date('2026-08-03T00:00:00Z'));
    const scheduledNames = result.phases.filter(phase => phase.startDate).map(phase => phase.phaseName);
    expect(scheduledNames).toHaveLength(expected.length);
    expect(scheduledNames).toEqual(expect.arrayContaining(expected));
  });

  it('should place status zero after Ideia Registrada in the automatic queue', async () => {
    const makeProject = (id: string, status: number): EngineProject => ({
      id, sdNumber: id, title: id, requester: 'TIC', totalHours: 1, status,
      isLegalRequirement: false, businessPriorityCode: 'alta', committeeDecision: null, committeeScore: null,
      openingDate: new Date('2026-08-03T00:00:00Z'), requestedDeadline: null, phases: [],
    });
    const sorted = await service.sortFilaAutomatic([makeProject('diretoria', 0), makeProject('ideia', 1)]);
    expect(sorted.map(project => project.id)).toEqual(['ideia', 'diretoria']);
  });

  it('should schedule sequential resources and dependent phases on the next productive day', () => {
    const resources: EngineResource[] = [
      { id: 'r-seq-1', name: 'Primeiro', weeklyHours: 40, overheadPercentage: 0, developmentPercentage: 1, recommendedWipLimit: 3, unavailabilities: [] },
      { id: 'r-seq-2', name: 'Segundo', weeklyHours: 40, overheadPercentage: 0, developmentPercentage: 1, recommendedWipLimit: 3, unavailabilities: [] },
    ];
    const project: EngineProject = {
      id: 'p-seq', sdNumber: 'SD-SEQ', title: 'Dependências', requester: 'TI', totalHours: 3,
      status: 5, isLegalRequirement: false, businessPriorityCode: 'alta', committeeDecision: 'PRIORIZADO', committeeScore: 10,
      openingDate: new Date('2026-08-03T00:00:00Z'), requestedDeadline: null,
      phases: [
        { id: 'seq-design', phaseId: 'design', name: 'Design', percentage: 66, order: 1, totalMinutes: 120, executionMode: 'SEQUENTIAL', allocations: [
          { id: 'seq-a1', resourceId: 'r-seq-1', minutesAllocated: 60, order: 1 },
          { id: 'seq-a2', resourceId: 'r-seq-2', minutesAllocated: 60, order: 2 },
        ] },
        { id: 'seq-dev', phaseId: 'dev', name: 'Desenvolvimento', percentage: 34, order: 2, totalMinutes: 60, executionMode: 'SIMULTANEOUS', allocations: [
          { id: 'seq-a3', resourceId: 'r-seq-1', minutesAllocated: 60, order: 1 },
        ] },
      ],
    };

    const result = service.simulateAllocationSchedule([project], resources, [], 'automatic', [], [project], 'all_eligible', new Date('2026-08-03T00:00:00Z'));
    const allocationDates = Object.fromEntries(result.allocations.map(allocation => [allocation.allocationId, allocation.date.toISOString().split('T')[0]]));
    expect(allocationDates['seq-a1']).toBe('2026-08-03');
    expect(allocationDates['seq-a2']).toBe('2026-08-04');
    expect(allocationDates['seq-a3']).toBe('2026-08-05');
  });

  it('should not impede a project when only the management phase has no resource', () => {
    const resource: EngineResource = { id: 'r-delivery', name: 'Entrega', weeklyHours: 40, overheadPercentage: 0, developmentPercentage: 1, recommendedWipLimit: 3, unavailabilities: [] };
    const project: EngineProject = {
      id: 'p-management-warning', sdNumber: 'SD-GP', title: 'Gestão sem recurso', requester: 'TI', totalHours: 2,
      status: 1, isLegalRequirement: false, businessPriorityCode: 'alta', committeeDecision: 'PRIORIZADO', committeeScore: 10,
      openingDate: new Date('2026-08-03T00:00:00Z'), requestedDeadline: null,
      phases: [
        { id: 'gp-no-resource', phaseId: 'gp', name: 'Gestão de Projetos', percentage: 50, order: 1, totalMinutes: 60, executionMode: 'SIMULTANEOUS', allocations: [] },
        { id: 'delivery-with-resource', phaseId: 'dev', name: 'Desenvolvimento', percentage: 50, order: 2, totalMinutes: 60, executionMode: 'SIMULTANEOUS', allocations: [{ id: 'delivery-allocation', resourceId: resource.id, minutesAllocated: 60, order: 1 }] },
      ],
    };

    const result = service.simulateAllocationSchedule([project], [resource], [], 'automatic', [], [project], 'all_eligible', new Date('2026-08-03T00:00:00Z'));
    expect(result.projects[0].isImpeded).toBe(false);
    expect(result.projects[0].endDate?.toISOString().split('T')[0]).toBe('2026-08-03');
    expect(result.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'MANAGEMENT_PHASE_NO_RESOURCE' })]));
  });

  it('keeps an incomplete phase and its project without a completion forecast', () => {
    const resource: EngineResource = { id: 'r-horizon', name: 'Capacidade', weeklyHours: 40, overheadPercentage: 0, developmentPercentage: 1, recommendedWipLimit: 3, unavailabilities: [] };
    const project: EngineProject = {
      id: 'p-horizon', sdNumber: 'SD-H', title: 'Além do horizonte', requester: 'TI', totalHours: 16,
      status: 1, isLegalRequirement: false, businessPriorityCode: 'media', committeeDecision: 'PRIORIZADO', committeeScore: 5,
      openingDate: new Date('2026-08-03T00:00:00Z'), requestedDeadline: null,
      phases: [{ id: 'phase-horizon', phaseId: 'dev', phaseCode: 'desenvolvimento', name: 'Desenvolvimento', percentage: 100, order: 1, totalMinutes: 960, executionMode: 'SIMULTANEOUS', allocations: [{ id: 'allocation-horizon', resourceId: resource.id, minutesAllocated: 960, order: 1 }] }],
    };
    const result = service.simulateAllocationSchedule([project], [resource], [], 'automatic', [], [project], 'all_eligible', new Date('2026-08-03T00:00:00Z'), 'soft', 0);
    expect(result.projects[0]).toEqual(expect.objectContaining({ isImpeded: true, startDate: null, endDate: null }));
    expect(result.phases[0]).toEqual(expect.objectContaining({ startDate: new Date('2026-08-03T00:00:00Z'), endDate: null }));
  });
});
