import { BadRequestException } from '@nestjs/common';

const invalid = (message: string) => { throw new BadRequestException({ code: 'PROJECT_EFFORT_INVALID', message }); };
export function calculatePhaseMinutes(totalHours: number, phases: { id: string; name: string; code?: string; value: string | null; order: number | null }[]) {
  if (!Number.isFinite(totalHours) || totalHours <= 0) invalid('Horas estimadas devem ser positivas e finitas.');
  if (!phases.length) invalid('O projeto precisa de fases para distribuir seu esforço.');
  const total = Math.round(totalHours * 60);
  if (total < 1 || !Number.isSafeInteger(total)) invalid('Horas estimadas fora do limite permitido.');
  const values = phases.map(p => Number(p.value));
  if (values.some(v => !Number.isFinite(v) || v < 0 || v > 100) || Math.abs(values.reduce((a,b) => a+b,0)-100)>0.001) invalid('Os percentuais das fases devem ser válidos e somar 100%.');
  const result = phases.map((p,i) => ({ phaseId:p.id, name:p.name, percentage:values[i], order:p.order ?? 0, totalMinutes:Math.floor(total*values[i]/100) }));
  const residue = total-result.reduce((sum,p)=>sum+p.totalMinutes,0);
  const index = phases.findIndex(p => p.code === 'desenvolvimento' || (!p.code && p.name === 'Desenvolvimento'));
  result[index >= 0 ? index : 0].totalMinutes += residue;
  if (result.some(p=>p.totalMinutes<0)) invalid('Distribuição inválida das horas entre fases.');
  return result;
}

export function calculateResourceSplit(totalMinutes: number, resourceIds: string[], mode: string, resourceOrder?: string[]) {
  if (!Number.isSafeInteger(totalMinutes) || totalMinutes < 0) invalid('Minutos da fase devem ser inteiros e não negativos.');
  if (!['SIMULTANEOUS','SEQUENTIAL'].includes(mode)) invalid('Modo de execução inválido.');
  if (new Set(resourceIds).size !== resourceIds.length || resourceIds.some(id=>typeof id !== 'string' || !id.trim())) invalid('Recursos devem possuir IDs válidos e únicos.');
  if (resourceOrder && (new Set(resourceOrder).size !== resourceOrder.length || resourceOrder.some(id=>!resourceIds.includes(id)))) invalid('Ordem dos recursos contém IDs repetidos ou inválidos.');
  if (!resourceIds.length) return [];
  const ids = mode==='SEQUENTIAL' && resourceOrder ? [...resourceOrder,...resourceIds.filter(id=>!resourceOrder.includes(id))] : resourceIds;
  return ids.map((resourceId,index)=>({resourceId,minutesAllocated:Math.floor(totalMinutes/ids.length)+(index<totalMinutes%ids.length?1:0),order:index+1}));
}

export function normalizeProjectEffort(project: any) {
  const calculated = calculatePhaseMinutes(project.totalHours, project.phases.map((p:any)=>({id:p.phaseId,name:p.name,code:p.phaseCode ?? p.phaseCatalog?.code,value:String(p.percentage),order:p.order})));
  for (const phase of project.phases) {
    phase.totalMinutes = calculated.find(p=>p.phaseId===phase.phaseId)!.totalMinutes;
    const ordered = [...phase.allocations].sort((a:any,b:any)=>a.order-b.order || a.id.localeCompare(b.id));
    const splits=calculateResourceSplit(phase.totalMinutes,ordered.map((a:any)=>a.resourceId),phase.executionMode,ordered.map((a:any)=>a.resourceId));
    for (const allocation of phase.allocations) allocation.minutesAllocated=splits.find(s=>s.resourceId===allocation.resourceId)!.minutesAllocated;
  }
  return project;
}

export function effortConsistencyError(project: any): string | null {
  if (!Number.isFinite(project.totalHours) || project.totalHours<=0 || !project.phases.length) return 'Horas ou fases do projeto inválidas';
  if (project.phases.some((p:any)=>!Number.isSafeInteger(p.totalMinutes)||p.totalMinutes<0||!Number.isFinite(p.percentage)||p.percentage<0||p.percentage>100)) return 'Minutos ou percentuais das fases inválidos';
  if (Math.abs(project.phases.reduce((sum:number,p:any)=>sum+p.percentage,0)-100)>0.001 || project.phases.reduce((sum:number,p:any)=>sum+p.totalMinutes,0)!==Math.round(project.totalHours*60)) return 'As horas das fases divergem das horas estimadas do projeto';
  for (const phase of project.phases) {
    if (!['SIMULTANEOUS','SEQUENTIAL'].includes(phase.executionMode)) return 'Modo de execução da fase inválido';
    if (new Set(phase.allocations.map((a:any)=>a.resourceId)).size!==phase.allocations.length || phase.allocations.some((a:any)=>!Number.isSafeInteger(a.minutesAllocated)||a.minutesAllocated<0)) return 'Alocações inválidas na fase';
    if (phase.allocations.length && phase.allocations.reduce((sum:number,a:any)=>sum+a.minutesAllocated,0)!==phase.totalMinutes) return 'As alocações divergem dos minutos da fase';
  }
  return null;
}

export async function reconcileProjectEffort(tx: any, projectId: string, totalHours: number) {
  const phases=await tx.projectPhase.findMany({where:{projectId},include:{phaseCatalog:{select:{code:true}},allocations:true},orderBy:{order:'asc'}});
  const before=JSON.parse(JSON.stringify(phases));
  normalizeProjectEffort({totalHours,phases});
  let changed=false;
  for (const phase of phases) {
    const previous=before.find((p:any)=>p.id===phase.id);
    if (previous.totalMinutes!==phase.totalMinutes) { changed=true; await tx.projectPhase.update({where:{id:phase.id},data:{totalMinutes:phase.totalMinutes}}); }
    for (const allocation of phase.allocations) if (previous.allocations.find((a:any)=>a.id===allocation.id).minutesAllocated!==allocation.minutesAllocated) {
      changed=true; await tx.projectPhaseAllocation.update({where:{id:allocation.id},data:{minutesAllocated:allocation.minutesAllocated}});
    }
  }
  return {changed,before,after:phases};
}
