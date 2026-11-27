/** SYNTHETIC receipt shared by offline tests only. No real provider prices or refresh. */
export function moneylineReceiptFixture(){
 const track=name=>({track:name,outcome:'saved',providerGames:1,gamesStored:1,pricesOffered:2,oddsInserted:2,oddsVerified:2,
  newestSourceObservedAt:'2026-11-27T10:59:00Z',rejectedEvents:0,skippedLive:0,skippedMarkets:0});
 const tracks={nba:track('nba'),soccer:track('soccer')};
 return {slots:[{slot_key:'moneyline-h2h-2026-11-27',run_id:42,claimed_at:'2026-11-27T11:02:00Z'}],
  runs:[{id:42,status:'completed',created_at:'2026-11-27T11:02:00Z',claimed_at:'2026-11-27T11:02:01Z',finished_at:'2026-11-27T11:02:30Z',probe:false,
   summary:{runId:42,status:'refreshed',tracks:{nba:'saved',soccer:'saved'},report:{tracks},privateSyntheticValue:'NEVER_PUBLIC',capability_hash:'NEVER_PUBLIC'}}]};
}
