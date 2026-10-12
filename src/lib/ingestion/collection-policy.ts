import type {Track} from './normalize';

/** Only explicit allowed sportsbook data tracks can trigger provider requests. */
export type CollectionChoice = 'nba'|'soccer'|'both';
export function parseCollectionChoice(raw:string|null):CollectionChoice{
 if(raw===null||raw==='both')return 'both'; // backwards compatible when choosing the plan
 if(raw==='nba'||raw==='soccer')return raw;
 throw new Error('Choose nba, soccer, or both');
}
export function collectionTracks(choice:CollectionChoice):Track[]{
 return choice==='both'?['nba','soccer']:[choice];
}
export function validateCollectionTracks(value:readonly unknown[]):Track[]{
 if(!Array.isArray(value)||value.length<1||value.length>2)throw new Error('One or two supported tracks required');
 const seen=new Set<string>();
 for(const item of value){
  if((item!=='nba'&&item!=='soccer')||seen.has(item))
    throw new Error('Invalid or repeated collection track');
  seen.add(item);
 }
 return value as Track[];
}
export function describeCollection(choice:CollectionChoice){
 const tracks=collectionTracks(choice);
 return {choice,tracks,providerRequestsPlanned:tracks.length,
  providerCreditsUnknown:true,
  note:'The request count is not the billable credits consumed. Credits depend on the provider plan, markets, regions and response headers. This plan does not fetch market data.'};
}
