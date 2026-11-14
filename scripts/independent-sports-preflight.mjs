/**
 * Opt-in, read-only source compatibility check. Uses one free public release
 * GET for the selected league. No database, research-data or account writes.
 *
 * node scripts/independent-sports-preflight.mjs nfl
 * node scripts/independent-sports-preflight.mjs nhl
 */
import {leagues,preflightIndependentSports} from './independent-sports-collect.mjs';

const league=process.argv[2];
if(process.argv.length!==3||!leagues.includes(league)){
 console.error('Usage: node scripts/independent-sports-preflight.mjs nfl|nhl');
 process.exitCode=2;
}else{
 preflightIndependentSports({league}).then(report=>{
  console.log(JSON.stringify(report,null,2));
 }).catch(err=>{
  console.error(err instanceof Error?err.message:'SPORTS_PREFLIGHT_FAILED');
  process.exitCode=1;
 });
}
