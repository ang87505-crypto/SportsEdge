-- Additive server-only research ledger. No real wagers or user accounts.
create table public.research_model_versions (
 version text primary key, source_revision text not null, ratings_as_of timestamptz not null,
 home_advantage numeric not null, ratings jsonb not null, team_names jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create table public.research_fixture_checks (
 game_id bigint primary key references public.games(id), home_model_id text not null,
 away_model_id text not null, verified_starts_at timestamptz not null,
 source_url text not null check (source_url like 'https://www.nba.com/%'),
 season_type text not null check(season_type='regular'),
 checked_at timestamptz not null default clock_timestamp()
);
create table public.research_forecasts (
 id bigint generated always as identity primary key, game_id bigint not null references public.games(id),
 model_version text not null references public.research_model_versions(version),
 home_probability numeric not null check(home_probability>0 and home_probability<1),
 starts_at timestamptz not null, published_at timestamptz not null default clock_timestamp(),
 source_revision text not null, unique(game_id,model_version), check(published_at<starts_at)
);
create table public.research_accounts (
 id bigint generated always as identity primary key, slug text unique not null,
 initial_cents bigint not null check(initial_cents>0), created_at timestamptz not null default clock_timestamp()
);
create table public.research_positions (
 id bigint generated always as identity primary key, account_id bigint not null references public.research_accounts(id),
 forecast_id bigint not null references public.research_forecasts(id),
 odds_snapshot_id bigint not null references public.odds_snapshots(id),
 selection text not null, american_odds integer not null check(abs(american_odds)>=100),
 probability numeric not null check(probability>0 and probability<1), no_vig_probability numeric not null,
 stake_cents bigint not null check(stake_cents>0), placed_at timestamptz not null default clock_timestamp(),
 unique(account_id,forecast_id)
);
create table public.research_results (
 game_id bigint primary key references public.games(id), status text not null check(status in ('final','cancelled')),
 home_score integer, away_score integer, source_url text not null,
 recorded_at timestamptz not null default clock_timestamp(),
 check((status='final' and home_score>=0 and away_score>=0 and home_score<>away_score) or (status='cancelled' and home_score is null and away_score is null))
);
create table public.research_settlements (
 position_id bigint primary key references public.research_positions(id),
 outcome text not null check(outcome in ('won','lost','void')),
 profit_cents bigint not null, settled_at timestamptz not null default clock_timestamp()
);

create function public.research_immutable() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'Research audit rows are immutable; append a new version instead'; end $$;

do $$ declare t text; begin
 foreach t in array array['research_model_versions','research_fixture_checks','research_forecasts','research_accounts','research_positions','research_results','research_settlements'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant select, insert, update on public.%I to service_role',t);
 execute format('create trigger protect_audit before update or delete on public.%I for each row execute function public.research_immutable()',t);
 end loop;
end $$;
grant usage,select on sequence public.research_forecasts_id_seq,public.research_accounts_id_seq,public.research_positions_id_seq to service_role;

create function public.research_publish(p_game bigint,p_version text) returns bigint
language plpgsql security invoker set search_path='' as $$
declare g public.games; c public.research_fixture_checks; m public.research_model_versions; answer bigint; p numeric;
begin
 perform pg_advisory_xact_lock(p_game);
 select id into answer from public.research_forecasts where game_id=p_game and model_version=p_version;
 if found then return answer; end if;
 select * into strict g from public.games where id=p_game;
 select * into strict c from public.research_fixture_checks where game_id=p_game;
 select * into strict m from public.research_model_versions where version=p_version;
 if g.status<>'scheduled' or g.starts_at<=clock_timestamp() or g.starts_at<>c.verified_starts_at or m.ratings_as_of>=clock_timestamp() or m.ratings_as_of>=g.starts_at then raise exception 'Not eligible for a pregame forecast'; end if;
 if not (m.ratings ? c.home_model_id and m.ratings ? c.away_model_id) then raise exception 'Missing trained team'; end if;
 if (select name from public.teams where id=g.home_team_id)<>m.team_names->>c.home_model_id or (select name from public.teams where id=g.away_team_id)<>m.team_names->>c.away_model_id then raise exception 'Team mapping mismatch'; end if;
 p:=1/(1+power(10::numeric,-(((m.ratings->>c.home_model_id)::numeric+m.home_advantage-(m.ratings->>c.away_model_id)::numeric)/400)));
 insert into public.research_forecasts(game_id,model_version,home_probability,starts_at,source_revision) values(p_game,p_version,p,g.starts_at,m.source_revision) returning id into answer;
 return answer;
end $$;

create function public.research_place(p_account bigint,p_forecast bigint,p_quote bigint) returns bigint
language plpgsql security invoker set search_path='' as $$
declare a public.research_accounts; f public.research_forecasts; o public.odds_snapshots; other public.odds_snapshots; g public.games; home text; away text; prob numeric; implied numeric; opposing numeric; decimal_odds numeric; available bigint; stake bigint; answer bigint;
begin
 select * into strict a from public.research_accounts where id=p_account for update;
 select id into answer from public.research_positions where account_id=p_account and forecast_id=p_forecast;
 if found then return answer; end if;
 select * into strict f from public.research_forecasts where id=p_forecast;
 select * into strict g from public.games where id=f.game_id;
 select * into strict o from public.odds_snapshots where id=p_quote;
 select name into home from public.teams where id=g.home_team_id;
 select name into away from public.teams where id=g.away_team_id;
 if g.status<>'scheduled' or g.starts_at<>f.starts_at or clock_timestamp()>=f.starts_at or o.game_id<>g.id or o.market<>'h2h' or o.line is not null or o.selection not in (home,away) then raise exception 'Ineligible moneyline quote'; end if;
 if o.observed_at>clock_timestamp() or o.ingested_at>clock_timestamp() or o.observed_at<clock_timestamp()-interval '1 hour' or o.ingested_at<clock_timestamp()-interval '1 hour' or o.observed_at>=f.starts_at or o.ingested_at>=f.starts_at then raise exception 'Quote is stale or not pregame'; end if;
 select * into strict other from public.odds_snapshots where game_id=g.id and sportsbook=o.sportsbook and provider=o.provider and market='h2h' and line is null and observed_at=o.observed_at and selection=case when o.selection=home then away else home end order by ingested_at desc,id desc limit 1;
 if other.ingested_at>clock_timestamp() or other.ingested_at<clock_timestamp()-interval '1 hour' then raise exception 'Opposing quote stale'; end if;
 prob:=case when o.selection=home then f.home_probability else 1-f.home_probability end;
 decimal_odds:=case when o.american_odds>0 then 1+o.american_odds::numeric/100 else 1+100/abs(o.american_odds)::numeric end;
 implied:=1/decimal_odds;
 opposing:=case when other.american_odds>0 then 100/(other.american_odds::numeric+100) else abs(other.american_odds)::numeric/(abs(other.american_odds)::numeric+100) end;
 -- Fixed research rule: model EV >= 2%, positive proportional no-vig edge.
 if prob*decimal_odds-1<0.02 or prob<=implied/(implied+opposing) then raise exception 'Does not pass fixed research selection rule'; end if;
 select a.initial_cents+coalesce((select sum(s.profit_cents) from public.research_settlements s join public.research_positions p on p.id=s.position_id where p.account_id=a.id),0)-coalesce((select sum(p.stake_cents) from public.research_positions p left join public.research_settlements s on s.position_id=p.id where p.account_id=a.id and s.position_id is null),0) into available;
 stake:=floor(available*0.01);
 if stake<100 then raise exception 'Insufficient available virtual bankroll'; end if;
 insert into public.research_positions(account_id,forecast_id,odds_snapshot_id,selection,american_odds,probability,no_vig_probability,stake_cents) values(a.id,f.id,o.id,o.selection,o.american_odds,prob,implied/(implied+opposing),stake) returning id into answer;
 return answer;
end $$;

create function public.research_record_result(p_game bigint,p_status text,p_home integer,p_away integer,p_source text) returns void
language plpgsql security invoker set search_path='' as $$
declare g public.games;
begin
 select * into strict g from public.games where id=p_game;
 if not exists(select 1 from public.research_fixture_checks where game_id=p_game) or g.starts_at>=clock_timestamp() or p_source not like 'https://site.api.espn.com/%' then raise exception 'Unverified result identity or source'; end if;
 insert into public.research_results(game_id,status,home_score,away_score,source_url) values(p_game,p_status,p_home,p_away,p_source) on conflict do nothing;
 if not exists(select 1 from public.research_results where game_id=p_game and status=p_status and home_score is not distinct from p_home and away_score is not distinct from p_away and source_url=p_source) then raise exception 'Result conflicts with immutable prior result'; end if;
end $$;

create function public.research_settle() returns bigint language plpgsql security invoker set search_path='' as $$
declare added bigint;
begin
 insert into public.research_settlements(position_id,outcome,profit_cents)
 select p.id,case when r.status='cancelled' then 'void' when (p.selection=h.name)=(r.home_score>r.away_score) then 'won' else 'lost' end,
 case when r.status='cancelled' then 0 when (p.selection=h.name)=(r.home_score>r.away_score) then round(p.stake_cents::numeric*case when p.american_odds>0 then p.american_odds::numeric/100 else 100/abs(p.american_odds)::numeric end)::bigint else -p.stake_cents end
 from public.research_positions p join public.research_forecasts f on f.id=p.forecast_id join public.research_results r on r.game_id=f.game_id join public.games g on g.id=f.game_id join public.teams h on h.id=g.home_team_id
 on conflict do nothing;
 get diagnostics added=row_count; return added;
end $$;
revoke execute on function public.research_immutable(),public.research_publish(bigint,text),public.research_place(bigint,bigint,bigint),public.research_record_result(bigint,text,integer,integer,text),public.research_settle() from public,anon,authenticated;
grant execute on function public.research_immutable(),public.research_publish(bigint,text),public.research_place(bigint,bigint,bigint),public.research_record_result(bigint,text,integer,integer,text),public.research_settle() to service_role;
