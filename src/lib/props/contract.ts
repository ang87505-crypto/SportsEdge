/**
 * NBA player-prop paper testing: shared, frozen identifiers and limits.
 *
 * This experiment is separate from the NBA moneyline Elo experiment
 * (`nba-elo-k20-h65-2026-04-v1`, research_* tables). It has its own model
 * versions, cohorts, ledgers and tables (props_*). Nothing here places a real
 * entry, contacts a DFS account, or reads a private platform endpoint.
 */
export const PROPS_PROVIDER='the_odds_api' as const;
export const PROPS_SPORT_KEY='basketball_nba' as const;
export const PROPS_REGION='us_dfs' as const;

export const PLATFORMS=['prizepicks','pick6'] as const;
export type Platform=typeof PLATFORMS[number];
/** The Odds API bookmaker key for each platform (verified 2026-11-07 on the bookmaker list). */
export const PLATFORM_BOOKMAKER:Record<Platform,string>={prizepicks:'prizepicks',pick6:'pick6'};
export const PLATFORM_LABEL:Record<Platform,string>={prizepicks:'PrizePicks',pick6:'DraftKings Pick6'};
/**
 * Sportsbooks whose standard player props are requested alongside the DFS platforms, as a
 * professional-market reference. The Odds API counts up to 10 bookmakers as one region, so
 * adding them does not change the credit cost of a request. Never an account or an entry.
 */
export const SPORTSBOOKS=['draftkings','fanduel','betmgm','williamhill_us'] as const;
export type Sportsbook=typeof SPORTSBOOKS[number];
export const SPORTSBOOK_LABEL:Record<Sportsbook,string>={draftkings:'DraftKings',fanduel:'FanDuel',betmgm:'BetMGM',williamhill_us:'Caesars'};

export const STATS=['points','rebounds','assists'] as const;
export type Stat=typeof STATS[number];
/**
 * Standard full-game markets only. Goblins/demons (PrizePicks) and non-x1
 * multipliers (Pick6) are published under *_alternate markets, which v1 does
 * not request; any outcome that still carries a non-1 multiplier is rejected.
 */
export const STAT_MARKET:Record<Stat,string>={
 points:'player_points',rebounds:'player_rebounds',assists:'player_assists'};
export const MARKET_STAT:Record<string,Stat>=Object.fromEntries(
 Object.entries(STAT_MARKET).map(([s,m])=>[m,s as Stat]));

export const MODEL_VERSION='props-nb-minutes-rate-v1' as const;
export const SELECTION_VERSION='props-select-v1' as const;
/** v1 bands on the active (learning) model's probabilities, plus: skip when the sportsbooks clearly disagree. */
export const SELECTION_VERSION_V2='props-select-v2' as const;
export const NORMALIZER_VERSION='props-normalize-v1' as const;

/** Observation admission rules (frozen for v1). */
export const OBSERVATION_RULES={
 /** A quote whose provider last_update is older than this at ingestion is stale. */
 maxQuoteAgeMs:2*3600_000,
 /** Allowed provider clock skew (last_update after our receipt). */
 maxClockSkewMs:60_000,
 /** Nothing is recorded within this margin of the lock (scheduled start). */
 lockBufferMs:10*60_000,
 minLine:0.5,
 maxLine:99.5,
} as const;

export type ObservationReject=
 |'event_mismatch'|'event_locked'|'invalid_event'|'unknown_bookmaker'|'unsupported_market'
 |'missing_last_update'|'stale_quote'|'future_quote'|'quote_after_lock'
 |'invalid_outcome'|'invalid_line'|'special_multiplier'|'incomplete_pair'
 |'ambiguous_line'|'duplicate';

export type PropObservation={
 provider:typeof PROPS_PROVIDER;
 platform:Platform;
 bookmakerKey:string;
 providerEventId:string;
 homeTeam:string;
 awayTeam:string;
 commenceTime:string;
 lockAt:string;
 playerName:string;
 stat:Stat;
 marketKey:string;
 period:'full_game';
 line:number;
 overPrice:number|null;
 underPrice:number|null;
 overMultiplier:number|null;
 underMultiplier:number|null;
 providerLastUpdate:string;
 ingestedAt:string;
 /** Original outcome fields for this line, as received. */
 sourceFields:Record<string,unknown>;
 responseSha256:string;
};

export type RejectedObservation={
 platform:Platform|null;bookmakerKey:string|null;marketKey:string|null;
 playerName:string|null;line:number|null;reason:ObservationReject;
};

/** Current-season player logs are admitted from this date (the 2026-27 regular season began in late October 2026). */
export const PROPS_SEASON_START='2026-10-01T00:00:00Z';
