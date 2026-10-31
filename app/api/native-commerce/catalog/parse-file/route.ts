import { NextRequest, NextResponse } from 'next/server';
import { getInboxSession, INBOX_SESSION_COOKIE } from '../../../../lib/inbox-auth';
import { previewPdfFile, previewXlsxFile } from '../../../../lib/staging-office-import';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:NextRequest) {
  if(process.env.MW1_STAGING_MODE!=='true'){
    return NextResponse.json({ok:false,error:'Este importador solo está habilitado en el entorno de pruebas.'},{status:403});
  }
  const session=await getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
  if(!session||session.type!=='user'||!session.userId){
    return NextResponse.json({ok:false,error:'Inicia sesión para importar catálogos.'},{status:401});
  }
  if(!['owner','admin'].includes(session.roleKey.toLowerCase())){
    return NextResponse.json({ok:false,error:'No tienes permisos para importar catálogos.'},{status:403});
  }
  const length=Number(request.headers.get('content-length')||0);
  if(length>1_200_000){
    return NextResponse.json({ok:false,error:'Máximo 1 MB por archivo de prueba.'},{status:413});
  }
  let file:File;
  try {
    const form=await request.formData();
    const input=form.get('file');
    if(!(input instanceof File)){
      return NextResponse.json({ok:false,error:'Selecciona un archivo Excel o PDF.'},{status:400});
    }
    file=input;
  }catch{
    return NextResponse.json({ok:false,error:'No pude leer el archivo.'},{status:400});
  }
  if(file.size>1_000_000||file.size<20){
    return NextResponse.json({ok:false,error:'Tamaño de archivo no permitido (máximo 1 MB).'},{status:413});
  }
  const name=file.name.toLowerCase();
  const kind=name.endsWith('.xlsx')?'excel':name.endsWith('.pdf')?'pdf':null;
  if(!kind){
    return NextResponse.json({ok:false,error:'Este servicio solo procesa archivos .xlsx y PDF de texto.'},{status:400});
  }
  try{
    const buffer=Buffer.from(await file.arrayBuffer());
    const result=kind==='excel'?previewXlsxFile(buffer):previewPdfFile(buffer);
    return NextResponse.json({
      ok:true,kind,rows:result.rows,errors:result.errors,
      notes:kind==='pdf'?'Los PDF escaneados o con tablas complejas requieren un procesamiento posterior.':'Se importan datos de la primera hoja de Excel.',
    },{headers:{'cache-control':'no-store'}});
  }catch(error){
    return NextResponse.json({
      ok:false,error:error instanceof Error?error.message:'No se pudo interpretar el archivo.',
    },{status:422,headers:{'cache-control':'no-store'}});
  }
}
