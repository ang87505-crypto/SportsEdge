import {forecasts,paperPerformance} from '@/lib/server/research-db';
export async function GET(){
 try{const [predictions,paper]=await Promise.all([forecasts(),paperPerformance()]);return Response.json({predictions,paper},{headers:{'Cache-Control':'no-store'}});}
 catch{return Response.json({status:'unavailable',message:'Research ledger temporarily unavailable.'},{status:503});}
}
