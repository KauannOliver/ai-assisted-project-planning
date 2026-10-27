/* Run against an isolated database first. Apply requires the dry-run state hash. */
const fs = require('fs');
const api = process.env.API_DIST_PATH || '/app/apps/api/dist';
const { PrismaService } = require(`${api}/prisma/prisma.service.js`);
const { EngineService } = require(`${api}/engine/engine.service.js`);
const { effortConsistencyError, normalizeProjectEffort, reconcileProjectEffort } = require(`${api}/projects/project-effort.js`);
if (process.env.RECONCILE_DATABASE_NAME) {
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${process.env.RECONCILE_DATABASE_NAME}`;
  process.env.DATABASE_URL = url.toString();
}
const prisma = new PrismaService();
const engine = new EngineService(prisma);
const apply = process.argv.includes('--apply');
const sameDates = (a,b) => String(a?.startDate) === String(b?.startDate) && String(a?.endDate) === String(b?.endDate);
async function simulate(service, input, projects, queue) {
  return service.simulateAllocationSchedule(projects,input.resources,input.holidayBehavior === 'include' ? [] : input.holidays,queue?.mode || 'automatic',JSON.parse(queue?.manualOrder || '[]'),await service.sortFilaAutomatic(projects),input.eligibilityMode,input.startCalcDate,input.wipMode,input.maxScheduleDays,input.riskToleranceDays,input.workingDays);
}
async function run(tx) {
  if (apply) {
    if (!process.env.EXPECTED_STATE_HASH) throw new Error('Apply requires EXPECTED_STATE_HASH from a fresh dry run.');
    await tx.$executeRawUnsafe('LOCK TABLE "Project", "ProjectPhase", "ProjectPhaseAllocation", "Resource", "ResourceUnavailability", "GlobalParameter", "PriorityQueueState", "CatalogItem", "CommitteeMeetingEvaluation", "CurrentProjectSchedule", "CurrentPhaseSchedule", "CurrentResourceAllocation", "CurrentResourceUtilization", "CurrentEngineWarning" IN SHARE ROW EXCLUSIVE MODE');
  }
  const stateHash = await engine.getDatabaseStateHash(tx);
  if (apply && stateHash !== process.env.EXPECTED_STATE_HASH) throw new Error('Database changed since the dry run; create a new comparison.');
  const projects = await tx.project.findMany({include:{phases:{include:{phaseCatalog:{select:{code:true}},allocations:true},orderBy:{order:'asc'}}},orderBy:{sdNumber:'asc'}});
  const official = await tx.currentProjectSchedule.findMany();
  const input = await engine.fetchEngineInput(tx);
  const queue = await tx.priorityQueueState.findUnique({where:{id:'singleton'}});
  let oldEngine = engine;
  if (process.env.OLD_API_DIST_PATH) { const {EngineService: OldEngine} = require(`${process.env.OLD_API_DIST_PATH}/engine/engine.service.js`); oldEngine = new OldEngine(prisma); }
  const baseline = await simulate(oldEngine,input,structuredClone(input.projects),queue);
  const changes = [];
  const proposedProjects = structuredClone(projects);
  for (const project of proposedProjects) {
    if (!effortConsistencyError(project)) continue;
    const before = structuredClone(project.phases);
    normalizeProjectEffort(project);
    if (effortConsistencyError(project)) throw new Error(`Unable to reconcile ${project.sdNumber}`);
    changes.push({id:project.id,sd:project.sdNumber,status:project.status,totalHours:project.totalHours,before,after:project.phases});
  }
  const normalizedInput = structuredClone(input.projects);
  for (const project of normalizedInput) if (changes.some(c=>c.id===project.id)) normalizeProjectEffort(project);
  const proposed = await simulate(engine,input,normalizedInput,queue);
  if (proposed.utilization.some(u=>u.minutesBusy>u.minutesTotal)) throw new Error('Proposed schedule exceeds daily resource capacity.');
  const baselineMap = new Map(baseline.projects.map(p=>[p.projectId,p]));
  const officialMap = new Map(official.map(p=>[p.projectId,p]));
  const labels = new Map(projects.map(p=>[p.id,p.sdNumber]));
  const dateChanges = proposed.projects.filter(p=>!sameDates(p,baselineMap.get(p.projectId))).map(p=>({sd:labels.get(p.projectId),before:baselineMap.get(p.projectId),after:p}));
  const officialChanges = proposed.projects.filter(p=>!sameDates(p,officialMap.get(p.projectId))).map(p=>({sd:labels.get(p.projectId),before:officialMap.get(p.projectId),after:p}));
  const resourceTotals = list => {
    const totals = {};
    for (const p of list) if (![7,8,9].includes(p.status)) for(const phase of p.phases) for(const allocation of phase.allocations) totals[allocation.resourceId]=(totals[allocation.resourceId]||0)+allocation.minutesAllocated;
    return totals;
  };
  const report = {stateHash,referenceDate:input.startCalcDate,engineVersion:EngineService.ENGINE_VERSION,changes,dateChanges,officialChanges,officialBefore:official,resourceMinutesBefore:resourceTotals(projects),resourceMinutesAfter:resourceTotals(proposedProjects),portfolioBefore:baseline.portfolioEndDate,portfolioAfter:proposed.portfolioEndDate,capacityViolations:0,warnings:proposed.warnings};
  if (apply && changes.length) {
    const actor = await tx.user.findFirst({where:{role:'ADMIN',status:'ACTIVE',deletedAt:null}});
    if (!actor) throw new Error('An active administrator is required to record reconciliation.');
    for (const change of changes) {
      const result = await reconcileProjectEffort(tx,change.id,change.totalHours);
      await tx.businessEvent.create({data:{aggregateType:'PROJECT',aggregateId:change.id,eventType:'PROJECT_EFFORT_RECONCILED',description:`Estimativas das fases e recursos da SD ${change.sd} reconciliadas com ${change.totalHours} horas.`,userId:actor.id,actorName:'Reconciliação técnica autorizada',metadata:{source:'OPERATIONS',before:JSON.parse(JSON.stringify(result.before)),after:JSON.parse(JSON.stringify(result.after))}}});
    }
    const finalInput = await engine.fetchEngineInput(tx);
    const finalSimulation = await simulate(engine,finalInput,finalInput.projects,queue);
    await engine.persistSchedule(tx,finalSimulation,{triggerType:'PROJECT_EFFORT_RECONCILIATION',triggeredById:actor.id,inputHash:await engine.getDatabaseStateHash(tx)});
  }
  return report;
}
prisma.$transaction(run,{isolationLevel:apply?'Serializable':'RepeatableRead',timeout:120000}).then(report=>{
  if(process.env.REPORT_PATH) fs.writeFileSync(process.env.REPORT_PATH,JSON.stringify(report,null,2));
  console.log(JSON.stringify({apply,stateHash:report.stateHash,referenceDate:report.referenceDate,correctedProjects:report.changes.length,activeProjects:report.changes.filter(p=>![7,8,9].includes(p.status)).length,dateChanges:report.dateChanges.length,officialChanges:report.officialChanges.length,portfolioBefore:report.portfolioBefore,portfolioAfter:report.portfolioAfter,capacityViolations:report.capacityViolations}));
}).catch(error=>{console.error(error.message);process.exitCode=1}).finally(()=>prisma.$disconnect());
