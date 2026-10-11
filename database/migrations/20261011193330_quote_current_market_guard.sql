-- Prepared only; requires separately approved database application.
begin;
create function public.research_place_current(p_account bigint,p_forecast bigint,p_quote bigint,p_max_age_seconds integer default 60) returns bigint
language plpgsql security invoker set search_path='' set lock_timeout='2s' as $$
declare a public.research_accounts; f public.research_forecasts; o public.odds_snapshots; other public.odds_snapshots; g public.games; home text; away text; prob numeric; implied numeric; opposing numeric; decimal_odds numeric; available bigint; stake bigint; answer bigint;
begin
 if p_max_age_seconds is null or p_max_age_seconds<1 or p_max_age_seconds>60 then raise exception 'Invalid quote age policy'; end if;
 -- Short local transaction only: prevent concurrent quote writes and fixture changes.
 -- Table locks deliberately cover phantom inserts, which row locks cannot prevent.
 lock table public.odds_snapshots in share mode;
 lock table public.games in share mode;
 select * into strict a from public.research_accounts where id=p_account for update;
 select id into answer from public.research_positions where account_id=p_account and forecast_id=p_forecast;
 if found then return answer; end if;
 select * into strict f from public.research_forecasts where id=p_forecast;
 select * into strict g from public.games where id=f.game_id;
 select * into strict o from public.odds_snapshots where id=p_quote;
 select name into home from public.teams where id=g.home_team_id;
 select name into away from public.teams where id=g.away_team_id;
 if g.status<>'scheduled' or g.starts_at<>f.starts_at or clock_timestamp()>=f.starts_at or o.game_id<>g.id or o.market<>'h2h' or o.line is not null or o.selection not in (home,away) then raise exception 'Ineligible moneyline quote'; end if;
 if o.observed_at>clock_timestamp() or o.ingested_at>clock_timestamp() or o.observed_at<clock_timestamp()-make_interval(secs=>p_max_age_seconds) or o.ingested_at<clock_timestamp()-make_interval(secs=>p_max_age_seconds) or o.observed_at>=f.starts_at or o.ingested_at>=f.starts_at then raise exception 'Quote is stale or not pregame'; end if;
 select * into strict other from public.odds_snapshots where game_id=g.id and sportsbook=o.sportsbook and provider=o.provider and market='h2h' and line is null and observed_at=o.observed_at and selection=case when o.selection=home then away else home end order by ingested_at desc,id desc limit 1;
 if other.ingested_at>clock_timestamp() or other.ingested_at<clock_timestamp()-make_interval(secs=>p_max_age_seconds) then raise exception 'Opposing quote stale'; end if;
 if f.published_at>clock_timestamp() or f.published_at>=f.starts_at or not (f.home_probability>0 and f.home_probability<1) then raise exception 'Invalid published forecast'; end if;
 if o.observed_at>o.ingested_at or other.observed_at>other.ingested_at then raise exception 'Invalid observation chronology'; end if;
 if exists(select 1 from public.odds_snapshots n where n.game_id=g.id and n.sportsbook=o.sportsbook and n.provider=o.provider and n.market='h2h' and n.line is null and n.observed_at>o.observed_at) then raise exception 'Quote superseded'; end if;
 if (select count(*) from public.odds_snapshots n where n.game_id=g.id and n.sportsbook=o.sportsbook and n.provider=o.provider and n.market='h2h' and n.line is null and n.observed_at=o.observed_at)<>2 then raise exception 'Ambiguous or incomplete market'; end if;
 if abs(o.american_odds::numeric)<100 or abs(other.american_odds::numeric)<100 then raise exception 'Invalid American odds'; end if;
 prob:=case when o.selection=home then f.home_probability else 1-f.home_probability end;
 decimal_odds:=case when o.american_odds>0 then 1+o.american_odds::numeric/100 else 1+100/abs(o.american_odds)::numeric end;
 implied:=1/decimal_odds;
 opposing:=case when other.american_odds>0 then 100/(other.american_odds::numeric+100) else abs(other.american_odds)::numeric/(abs(other.american_odds)::numeric+100) end;
 -- Fixed research rule: model EV >= 2%, positive proportional no-vig edge.
 if prob*decimal_odds-1<0.02 or prob<=implied/(implied+opposing) then raise exception 'Does not pass fixed research selection rule'; end if;
 select a.initial_cents+coalesce((select sum(s.profit_cents) from public.research_settlements s join public.research_positions p on p.id=s.position_id where p.account_id=a.id),0)-coalesce((select sum(p.stake_cents) from public.research_positions p left join public.research_settlements s on s.position_id=p.id where p.account_id=a.id and s.position_id is null),0) into available;
 stake:=floor(available*0.01);
 if stake<100 then raise exception 'Insufficient available virtual bankroll'; end if;
 if clock_timestamp()>=g.starts_at or o.observed_at<clock_timestamp()-make_interval(secs=>p_max_age_seconds) then raise exception 'Quote expired before recording'; end if;
 insert into public.research_positions(account_id,forecast_id,odds_snapshot_id,selection,american_odds,probability,no_vig_probability,stake_cents) values(a.id,f.id,o.id,o.selection,o.american_odds,prob,implied/(implied+opposing),stake) returning id into answer;
 return answer;
end $$;

-- Preserve the legacy signature, but it cannot bypass the new safety checks.
create or replace function public.research_place(p_account bigint,p_forecast bigint,p_quote bigint)
returns bigint language sql security invoker set search_path='' as $$
 select public.research_place_current(p_account,p_forecast,p_quote,60);
$$;
revoke all on function public.research_place_current(bigint,bigint,bigint,integer) from public,anon,authenticated;
grant execute on function public.research_place_current(bigint,bigint,bigint,integer) to service_role;
revoke all on function public.research_place(bigint,bigint,bigint) from public,anon,authenticated;
grant execute on function public.research_place(bigint,bigint,bigint) to service_role;

commit;
