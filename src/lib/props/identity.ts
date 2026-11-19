/**
 * Strict identity resolution between The Odds API (team/player display names)
 * and ESPN (team abbreviations, athlete ids). Ambiguity is never guessed:
 * anything not uniquely resolved is reported as unmatched.
 */
/** ESPN abbreviation -> accepted display names (The Odds API and ESPN spellings). */
export const NBA_TEAMS:Record<string,string[]>={
 ATL:['Atlanta Hawks'],BKN:['Brooklyn Nets'],BOS:['Boston Celtics'],CHA:['Charlotte Hornets'],
 CHI:['Chicago Bulls'],CLE:['Cleveland Cavaliers'],DAL:['Dallas Mavericks'],DEN:['Denver Nuggets'],
 DET:['Detroit Pistons'],GS:['Golden State Warriors'],HOU:['Houston Rockets'],IND:['Indiana Pacers'],
 LAC:['LA Clippers','Los Angeles Clippers'],LAL:['Los Angeles Lakers'],MEM:['Memphis Grizzlies'],
 MIA:['Miami Heat'],MIL:['Milwaukee Bucks'],MIN:['Minnesota Timberwolves'],NO:['New Orleans Pelicans'],
 NY:['New York Knicks'],OKC:['Oklahoma City Thunder'],ORL:['Orlando Magic'],PHI:['Philadelphia 76ers'],
 PHX:['Phoenix Suns'],POR:['Portland Trail Blazers'],SA:['San Antonio Spurs'],SAC:['Sacramento Kings'],
 TOR:['Toronto Raptors'],UTAH:['Utah Jazz'],WSH:['Washington Wizards'],
};
const byName=new Map<string,string>();
for(const [abbr,names] of Object.entries(NBA_TEAMS))for(const n of names)byName.set(n.toLowerCase(),abbr);
export const teamAbbr=(displayName:string):string|null=>byName.get(displayName.trim().toLowerCase())??null;

/** Accent-, punctuation- and suffix-insensitive player key ("Luka Dončić" == "Luka Doncic"). */
export function playerKey(name:string):string{
 return name.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()
  .replace(/[.'’`-]/g,' ').replace(/\b(jr|sr|ii|iii|iv|v)\b/g,' ').replace(/[^a-z0-9 ]/g,' ')
  .replace(/\s+/g,' ').trim();
}

export type RosterCandidate={athleteId:string;name:string;teamAbbr:string;lastGame:string};
export type PlayerMatch={status:'matched';athleteId:string;teamAbbr:string}|
 {status:'unmatched';reason:'unknown_team'|'player_not_found'|'ambiguous_player'};

/**
 * Resolve a provider player name for an event: the player's most recent team
 * (strictly before the cutoff) must be one of the two event teams, and exactly
 * one athlete may match the normalized name.
 */
export function matchPlayer(name:string,eventTeams:[string,string],candidates:RosterCandidate[]):PlayerMatch{
 const teams=eventTeams.map(teamAbbr);
 if(teams.some(t=>t===null))return {status:'unmatched',reason:'unknown_team'};
 const key=playerKey(name);
 const hits=candidates.filter(c=>playerKey(c.name)===key&&teams.includes(c.teamAbbr));
 const ids=new Set(hits.map(h=>h.athleteId));
 if(ids.size===0)return {status:'unmatched',reason:'player_not_found'};
 if(ids.size>1)return {status:'unmatched',reason:'ambiguous_player'};
 return {status:'matched',athleteId:hits[0].athleteId,teamAbbr:hits[0].teamAbbr};
}
