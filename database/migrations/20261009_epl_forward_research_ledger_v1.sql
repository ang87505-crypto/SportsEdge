-- Additive, isolated EPL forward research ledger. No NBA or user paper-bet writes.
-- Three-way winner/draw/winner market; source quotes must be complete and <=1h old.
create table public.research_epl_forecasts (
 game_id bigint primary key references public.games(id),
 model_version text not null check(model_version='epl-elo-k20-h65-draw-pre20260408-v1'),
 home_name text not null, away_name text not null,
 home_probability numeric not null check(home_probability>0 and home_probability<1),
 draw_probability numeric not null check(draw_probability>0 and draw_probability<1),
 away_probability numeric not null check(away_probability>0 and away_probability<1),
 starts_at timestamptz not null,
 source_revision text not null check(source_revision='e6744429ee395bc86f247348c6184bb08d4eb361'),
 source_last_result date not null check(source_last_result='2026-09-20'::date),
 fixture_source text not null check(fixture_source='https://www.premierleague.com/en/news/4688862/fixture-amendments-for-premier-league-matches-in-october-and-november'),
 published_at timestamptz not null default clock_timestamp(),
 check(abs(home_probability+draw_probability+away_probability-1)<0.000000001),
 check(published_at<starts_at)
);
create table public.research_epl_accounts (
 id bigint generated always as identity primary key,
 slug text not null unique,
 initial_cents bigint not null check(initial_cents>0),
 created_at timestamptz not null default clock_timestamp()
);
create table public.research_epl_positions (
 id bigint generated always as identity primary key,
 account_id bigint not null references public.research_epl_accounts(id),
 game_id bigint not null references public.research_epl_forecasts(game_id),
 odds_snapshot_id bigint not null references public.odds_snapshots(id),
 selection text not null, american_odds integer not null check(abs(american_odds)>=100),
 model_probability numeric not null check(model_probability>0 and model_probability<1),
 no_vig_probability numeric not null check(no_vig_probability>0 and no_vig_probability<1),
 stake_cents bigint not null check(stake_cents>0),
 placed_at timestamptz not null default clock_timestamp(),
 unique(account_id,game_id)
);
create table public.research_epl_results (
 game_id bigint primary key references public.research_epl_forecasts(game_id),
 status text not null check(status in ('final','cancelled')),
 home_score integer, away_score integer,
 source_url text not null check(source_url like 'https://www.premierleague.com/en/%'),
 recorded_at timestamptz not null default clock_timestamp(),
 check((status='final' and home_score>=0 and away_score>=0)
    or (status='cancelled' and home_score is null and away_score is null))
);
create table public.research_epl_settlements (
 position_id bigint primary key references public.research_epl_positions(id),
 outcome text not null check(outcome in ('won','lost','void')),
 profit_cents bigint not null,
 settled_at timestamptz not null default clock_timestamp()
);
-- Ensure publication remains pre-kickoff and matches a verified EPL fixture.
create function public.research_epl_check_forecast() returns trigger
language plpgsql security invoker set search_path='' as $$
declare sport text; status text; kick timestamptz; home text; away text;
begin
 select l.sport_code,g.status,g.starts_at,h.name,a.name
 into sport,status,kick,home,away
 from public.games g join public.leagues l on l.id=g.league_id
 join public.teams h on h.id=g.home_team_id
 join public.teams a on a.id=g.away_team_id where g.id=new.game_id;
 if sport is distinct from 'soccer' or status is distinct from 'scheduled'
  or kick is distinct from new.starts_at or kick<=clock_timestamp()
  or home is distinct from new.home_name or away is distinct from new.away_name then
   raise exception 'EPL forecast must match an upcoming verified fixture';
 end if;
 return new;
end $$;
create trigger validate_new_epl_forecast before insert on public.research_epl_forecasts
for each row execute function public.research_epl_check_forecast();
-- Reuse existing append-only audit protection; deny public and authenticated client access.
do $$ declare t text; begin
 foreach t in array array['research_epl_forecasts','research_epl_accounts',
 'research_epl_positions','research_epl_results','research_epl_settlements'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select,insert,update on public.%I to service_role',t);
  execute format('create trigger protect_audit before update or delete on public.%I for each row execute function public.research_immutable()',t);
 end loop;
end $$;
grant usage,select on sequence public.research_epl_accounts_id_seq,public.research_epl_positions_id_seq to service_role;
insert into public.research_epl_accounts(slug,initial_cents) values ('epl-elo-forward-v1',100000);

-- Account-level lock prevents concurrent over-reservation; no arbitrary/forced odds.
create function public.research_epl_place(p_account bigint,p_game bigint,p_quote bigint)
returns bigint language plpgsql security invoker set search_path='' as $$
declare a public.research_epl_accounts; f public.research_epl_forecasts;
 g public.games; q public.odds_snapshots; home text; away text;
 n bigint; distinct_n bigint; sum_implied numeric; own_implied numeric;
 win_prob numeric; dec numeric; cash bigint; stake bigint; existing bigint;
begin
 select * into strict a from public.research_epl_accounts where id=p_account for update;
 select id into existing from public.research_epl_positions where account_id=p_account and game_id=p_game;
 if found then return existing; end if;
 select * into strict f from public.research_epl_forecasts where game_id=p_game;
 select * into strict g from public.games where id=p_game;
 select * into strict q from public.odds_snapshots where id=p_quote;
 select name into home from public.teams where id=g.home_team_id;
 select name into away from public.teams where id=g.away_team_id;
 if g.status<>'scheduled' or g.starts_at<>f.starts_at or clock_timestamp()>=f.starts_at
   or q.game_id<>p_game or q.market<>'h2h' or q.line is not null
   or q.selection not in (home,away,'Draw') or q.observed_at>clock_timestamp()
   or q.ingested_at>clock_timestamp() or q.observed_at<clock_timestamp()-interval '1 hour'
   or q.ingested_at<clock_timestamp()-interval '1 hour' or q.observed_at>=f.starts_at
   or q.ingested_at>=f.starts_at then
  raise exception 'Ineligible, stale, or post-start quote';
 end if;
 select count(*),count(distinct selection),
 sum(case when american_odds>0 then 100::numeric/(american_odds+100)
 else abs(american_odds)::numeric/(abs(american_odds)+100) end)
 into n,distinct_n,sum_implied
 from public.odds_snapshots
 where game_id=p_game and sportsbook=q.sportsbook and provider=q.provider
 and market='h2h' and line is null and observed_at=q.observed_at
 and selection in (home,away,'Draw') and ingested_at<=clock_timestamp()
 and ingested_at>=clock_timestamp()-interval '1 hour';
 if n<>3 or distinct_n<>3 then raise exception 'Incomplete three-way pregame market'; end if;
 own_implied:=case when q.american_odds>0 then 100::numeric/(q.american_odds+100)
  else abs(q.american_odds)::numeric/(abs(q.american_odds)+100) end;
 win_prob:=case when q.selection=home then f.home_probability
   when q.selection=away then f.away_probability else f.draw_probability end;
 dec:=1+case when q.american_odds>0 then q.american_odds::numeric/100
   else 100/abs(q.american_odds)::numeric end;
 if win_prob*dec-1<0.02 or win_prob<=own_implied/sum_implied then
  raise exception 'Model quote fails pre-registered value rules';
 end if;
 select a.initial_cents+
 coalesce((select sum(s.profit_cents) from public.research_epl_settlements s
 join public.research_epl_positions p on p.id=s.position_id where p.account_id=a.id),0)-
 coalesce((select sum(p.stake_cents) from public.research_epl_positions p
 left join public.research_epl_settlements s on s.position_id=p.id
 where p.account_id=a.id and s.position_id is null),0) into cash;
 stake:=floor(cash*0.01);
 if stake<100 then raise exception 'Insufficient experimental bankroll'; end if;
 insert into public.research_epl_positions(account_id,game_id,odds_snapshot_id,
 selection,american_odds,model_probability,no_vig_probability,stake_cents)
 values(a.id,p_game,p_quote,q.selection,q.american_odds,win_prob,own_implied/sum_implied,stake)
 returning id into existing;
 return existing;
end $$;

-- Settlement only after a separately checked official final/cancellation is stored.
create function public.research_epl_settle() returns bigint
language plpgsql security invoker set search_path='' as $$
declare n bigint;
begin
 insert into public.research_epl_settlements(position_id,outcome,profit_cents)
 select p.id,
 case when r.status='cancelled' then 'void'
 when p.selection=(case when r.home_score>r.away_score then h.name
  when r.away_score>r.home_score then a.name else 'Draw' end) then 'won' else 'lost' end,
 case when r.status='cancelled' then 0
 when p.selection=(case when r.home_score>r.away_score then h.name
  when r.away_score>r.home_score then a.name else 'Draw' end)
 then round(p.stake_cents::numeric*case when p.american_odds>0 then
  p.american_odds::numeric/100 else 100/abs(p.american_odds)::numeric end)::bigint
 else -p.stake_cents end
 from public.research_epl_positions p
 join public.research_epl_results r on r.game_id=p.game_id
 join public.games g on g.id=p.game_id
 join public.teams h on h.id=g.home_team_id
 join public.teams a on a.id=g.away_team_id
 on conflict do nothing;
 get diagnostics n=row_count;
 return n;
end $$;
revoke all on function public.research_epl_check_forecast(),public.research_epl_place(bigint,bigint,bigint),public.research_epl_settle() from public,anon,authenticated;
grant execute on function public.research_epl_check_forecast(),public.research_epl_place(bigint,bigint,bigint),public.research_epl_settle() to service_role;
