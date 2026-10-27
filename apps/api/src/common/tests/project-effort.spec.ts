import { describe, it, expect, vi } from 'vitest';
import { calculatePhaseMinutes, calculateResourceSplit, normalizeProjectEffort, reconcileProjectEffort } from '../../projects/project-effort';
import { EngineService } from '../../engine/engine.service';

const date = new Date('2026-10-05T00:00:00Z');
const resources = ['r1','r2'].map(id=>({id,name:id,weeklyHours:40,overheadPercentage:0,developmentPercentage:1,recommendedWipLimit:3,unavailabilities:[]}));
const phase=(id:string,order:number,minutes:number,allocations:any[], mode='SEQUENTIAL')=>({id,phaseId:id,phaseCode:id,name:id,percentage:50,order,totalMinutes:minutes,executionMode:mode,allocations});
const project=(phases:any[])=>({id:'p',sdNumber:'p',title:'p',requester:'TI',totalHours:phases.reduce((s,p)=>s+p.totalMinutes,0)/60,status:0,isLegalRequirement:false,businessPriorityCode:'alta',committeeDecision:'PRIORIZADO',committeeScore:6,openingDate:date,requestedDeadline:null,phases});
const simulate=(p:any,maxDays=10)=>new EngineService(null as any).simulateAllocationSchedule([p],resources,[],'automatic',[],[p],'all_eligible',date,'soft',maxDays);

describe('effort reconciliation and calendar regressions',()=>{
  it('keeps the concurrency hash stable when database rows arrive in a different order',async()=>{
    const rows=[{id:'b',updatedAt:date},{id:'a',updatedAt:date}];
    const client:any=Object.fromEntries(['project','resource','resourceUnavailability','projectPhase','projectPhaseAllocation','globalParameter','committeeMeetingEvaluation'].map(key=>[key,{findMany:vi.fn(async()=>structuredClone(rows))}]));
    client.priorityQueueState={findUnique:vi.fn(async()=>null)};
    const engine=new EngineService(client);const first=await engine.getDatabaseStateHash();rows.reverse();expect(await engine.getDatabaseStateHash()).toBe(first);
  });
  it('reconciles 200 to 120 hours, preserving resource IDs and sequential order, and is idempotent',async()=>{
    const phases=[{...phase('desenvolvimento',1,12000,[{id:'a1',resourceId:'r1',minutesAllocated:6000,order:2},{id:'a2',resourceId:'r2',minutesAllocated:6000,order:1}]),percentage:100}];
    const tx:any={projectPhase:{findMany:vi.fn(async()=>structuredClone(phases)),update:vi.fn(async({data}:any)=>{phases[0].totalMinutes=data.totalMinutes})},projectPhaseAllocation:{update:vi.fn(async({where,data}:any)=>{phases[0].allocations.find(a=>a.id===where.id)!.minutesAllocated=data.minutesAllocated})}};
    const result=await reconcileProjectEffort(tx,'p',120);
    expect(result.changed).toBe(true); expect(phases[0].totalMinutes).toBe(7200);
    expect(phases[0].allocations.map(a=>[a.id,a.resourceId,a.order,a.minutesAllocated])).toEqual([['a1','r1',2,3600],['a2','r2',1,3600]]);
    expect((await reconcileProjectEffort(tx,'p',120)).changed).toBe(false);
  });
  it('uses the stable phase code for minute residue after a displayed name changes',()=>{
    const result=calculatePhaseMinutes(41,[{id:'x',name:'Outra',code:'gestao_projetos',value:'2.5',order:1},{id:'y',name:'Implementação',code:'desenvolvimento',value:'97.5',order:2}]);
    expect(result.map(p=>p.totalMinutes)).toEqual([61,2399]);
    expect(()=>calculatePhaseMinutes(120,[{id:'x',name:'x',value:'90',order:1}])).toThrow();
  });
  it('conserves integer minutes on increases, decreases and resource splits',()=>{
    for(const hours of [8,41,120,300]) { const p=project([{...phase('dev',1,600,[{id:'a1',resourceId:'r1',minutesAllocated:300,order:1},{id:'a2',resourceId:'r2',minutesAllocated:300,order:2}]),percentage:100}]);p.totalHours=hours;normalizeProjectEffort(p);expect(p.phases[0].totalMinutes).toBe(hours*60);expect(p.phases[0].allocations.reduce((s:number,a:any)=>s+a.minutesAllocated,0)).toBe(hours*60); }
    expect(calculateResourceSplit(1,['r1','r2'],'SEQUENTIAL').map(a=>a.minutesAllocated)).toEqual([1,0]);
    expect(()=>calculateResourceSplit(10,['r1','r1'],'SIMULTANEOUS')).toThrow();
    expect(()=>calculateResourceSplit(10,['r1','r2'],'SEQUENTIAL',['r1','r1'])).toThrow();
    expect(()=>calculateResourceSplit(10,['r1'],'invalid')).toThrow();
  });
  it('does not add a day for a trailing resource with zero minutes',()=>{
    const p=project([phase('levantamento',1,1,[{id:'a1',resourceId:'r1',minutesAllocated:1,order:1},{id:'a2',resourceId:'r2',minutesAllocated:0,order:2}]),phase('arquitetura',2,1,[{id:'a3',resourceId:'r1',minutesAllocated:1,order:1}])]);
    const result=simulate(p);
    expect(result.phases[0].endDate).toEqual(date);
    expect(result.phases[1].startDate).toEqual(new Date('2026-10-06T00:00:00Z'));
  });
  it('suspends forecasts with stale project totals without consuming shared capacity',()=>{
    const p=project([{...phase('dev',1,12000,[{id:'a1',resourceId:'r1',minutesAllocated:12000,order:1}]),percentage:100}]);p.totalHours=120;
    const result=simulate(p); expect(result.projects[0].endDate).toBeNull();expect(result.allocations).toHaveLength(0);
  });
  it('leaves incomplete management end null while preserving delivery and physical capacity',()=>{
    const p=project([phase('gestao_projetos',1,600,[{id:'a1',resourceId:'r1',minutesAllocated:600,order:1}]),phase('desenvolvimento',2,1,[{id:'a2',resourceId:'r1',minutesAllocated:1,order:1}])]);
    const result=simulate(p,0);expect(result.projects[0].endDate).toEqual(date);
    expect(result.phases.find(p=>p.isManagement)?.endDate).toBeNull();
    expect(result.utilization.every(u=>u.minutesBusy<=u.minutesTotal)).toBe(true);
  });
  it('honors recurring individual absences across year boundaries and partial global events',()=>{
    const engine=new EngineService(null as any);
    const r={...resources[0],unavailabilities:[{type:'FERIAS' as any,startDate:new Date('2025-12-24T00:00:00Z'),endDate:new Date('2026-01-02T00:00:00Z'),annualRecurrence:true,unavailableMinutesPerDay:60}]};
    const day=new Date('2027-12-27T00:00:00Z');const global=[{startDate:day,endDate:day,annualRecurrence:false,unavailableMinutesPerDay:90}];
    expect(engine.getResourceCapacityOnDate(day,r,global,new Map())).toBe(330);
    expect(engine.isGlobalHoliday(day,global)).toBe(false);
    expect(engine.getResourceCapacityOnDate(day,r,[{...global[0],unavailableMinutesPerDay:null}],new Map())).toBe(0);
    expect(engine.getResourceCapacityOnDate(new Date('2028-01-03T00:00:00Z'),r,[],new Map())).toBe(480);
  });
});
