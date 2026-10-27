const fs=require('fs');
const ExcelJS=require('exceljs');
if(process.env.RECONCILE_DATABASE_NAME) {const url=new URL(process.env.DATABASE_URL);url.pathname=`/${process.env.RECONCILE_DATABASE_NAME}`;process.env.DATABASE_URL=url.toString();}
const {PrismaService}=require('/app/apps/api/dist/prisma/prisma.service.js');
const {EngineService}=require('/app/apps/api/dist/engine/engine.service.js');
const {ImportsExportsController}=require('/app/apps/api/dist/imports-exports/imports-exports.controller.js');
const {effortConsistencyError}=require('/app/apps/api/dist/projects/project-effort.js');
const prisma=new PrismaService();
(async()=>{
  const projects=await prisma.project.findMany({include:{phases:{include:{allocations:{include:{resource:true}}}}}});
  const errors=projects.map(p=>({sd:p.sdNumber,error:effortConsistencyError(p)})).filter(p=>p.error);
  if(errors.length)throw new Error(`Remaining inconsistencies: ${JSON.stringify(errors)}`);
  let buffer;
  if(process.env.VERIFY_PUBLIC_URL){
    const actor=await prisma.user.findFirst({where:{role:'ADMIN',status:'ACTIVE',deletedAt:null,forcePasswordChange:false}});
    const token=require('jsonwebtoken').sign({userId:actor.id,tokenVersion:actor.tokenVersion},process.env.JWT_SECRET,{expiresIn:'3m'});
    const response=await fetch(process.env.VERIFY_PUBLIC_URL,{headers:{Cookie:`jwt_token=${token}`}});
    if(!response.ok)throw new Error(`Published export: HTTP ${response.status}`);
    buffer=Buffer.from(await response.arrayBuffer());
  }else{
    const controller=new ImportsExportsController(prisma,new EngineService(prisma),{});
    const workbook=await prisma.$transaction(tx=>controller.buildExportWorkbook('complete',tx),{isolationLevel:'RepeatableRead',timeout:120000});
    buffer=Buffer.from(await workbook.xlsx.writeBuffer());
  }
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);
  const expected=new Map();const detail=[];
  for(const p of projects)if(![7,8,9].includes(p.status))for(const phase of p.phases)for(const allocation of phase.allocations){expected.set(allocation.resource.name,(expected.get(allocation.resource.name)||0)+allocation.minutesAllocated/60);if(allocation.resource.name==='GUILHERME PENIDO')detail.push({sd:p.sdNumber,phase:phase.name,hours:allocation.minutesAllocated/60});}
  const rows=workbook.getWorksheet('Dados do Dashboard').getSheetValues().filter(r=>Array.isArray(r)&&r[1]==='Horas planejadas por recurso em projetos ativos');
  if(rows.length!==expected.size || rows.some(r=>Math.abs(r[3]-expected.get(r[2]))>0.0051))throw new Error('Workbook resource totals do not match the database.');
  const management=workbook.getWorksheet('Relatório Gerencial');
  const sds=Array.from({length:projects.length},(_,i)=>management.getCell(i+2,2).value);
  if(management.autoFilter!==`A1:J${projects.length+1}`)throw new Error('Management report table size differs from project count.');
  if(sds.length!==projects.length||new Set(sds).size!==projects.length)throw new Error('Management report duplicated or omitted projects.');
  const [{count:capacityViolations}]=await prisma.$queryRawUnsafe('SELECT count(*)::int AS count FROM "CurrentResourceUtilization" WHERE "minutesBusy">"minutesTotal"');
  if(capacityViolations)throw new Error('Daily capacity exceeded.');
  if(process.env.WORKBOOK_PATH)fs.writeFileSync(process.env.WORKBOOK_PATH,buffer);
  const result={projects:projects.length,sheets:workbook.worksheets.map(s=>s.name),inconsistencies:errors.length,guilhermeHours:expected.get('GUILHERME PENIDO'),guilhermeProjects:[...new Set(detail.map(d=>d.sd))],detail,capacityViolations,bytes:buffer.length};
  if(process.env.REPORT_PATH)fs.writeFileSync(process.env.REPORT_PATH,JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>prisma.$disconnect());
