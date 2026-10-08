import {storedSports} from '@/lib/server/research-db';
const sports=new Set(['nba','soccer','nfl','mlb','nhl','ncaaf','ncaab','tennis','mma']);
export async function GET(request:Request){
 const sport=new URL(request.url).searchParams.get('sport')??'nba';
 if(!sports.has(sport))return Response.json({error:'Unsupported sport'},{status:400});
 try{return Response.json(await storedSports(sport),{headers:{'Cache-Control':'no-store'}});}
 catch{return Response.json({status:'unavailable',games:[],message:'Stored odds are temporarily unavailable.'},{status:503});}
}

