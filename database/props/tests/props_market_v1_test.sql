\set ON_ERROR_STOP on
-- props_market_v1 contract tests (disposable DB; assumes props_v1_test.sql helpers and pinned clock).
SET ROLE service_role;
SELECT props_test.at('2026-11-09T18:00:30Z');
SELECT public.props_set_control('RUNNING','market v1 test','owner-test');
SELECT props_test.eq(public.props_begin_run('collect','collect-market-v1','gha:m1',NULL,600)->>'outcome','STARTED','market run');
SELECT id AS mrun FROM public.props_runs WHERE slot_key='collect-market-v1' \gset
INSERT INTO public.props_raw_responses(run_id,source,endpoint,external_id,http_status,received_at,content_sha256,body)
 VALUES(:mrun,'the_odds_api','event_odds','evtTEST000900',200,'2026-11-09T18:00:05Z',repeat('b',64),'{"id":"evtTEST000900"}');
SELECT id AS mraw FROM public.props_raw_responses WHERE external_id='evtTEST000900' \gset
SELECT props_test.obs(:mrun,:mraw,'evtTEST000900','Market Player','points',24.5,'2026-11-10T00:00:00Z',
 '2026-11-09T18:00:10Z','2026-11-09T17:59:00Z') AS mobs \gset

-- 1. A fresh pregame sportsbook quote is stored.
INSERT INTO public.props_book_quotes(run_id,raw_response_id,bookmaker_key,provider_event_id,player_name,stat,market_key,line,
 over_price,under_price,provider_last_update,ingested_at,lock_at,response_sha256)
 VALUES(:mrun,:mraw,'draftkings','evtTEST000900','Market Player','points','player_points',24.5,-150,130,
 '2026-11-09T17:59:00Z','2026-11-09T18:00:10Z','2026-11-10T00:00:00Z',repeat('b',64));
SELECT props_test.eq((SELECT count(*)::text FROM public.props_book_quotes),'1','quote stored');

-- 2. Chronology: at/after lock, stale (> 2 h) and unknown books are refused.
SELECT props_test.raises($$INSERT INTO public.props_book_quotes(run_id,raw_response_id,bookmaker_key,provider_event_id,player_name,stat,market_key,line,
 over_price,under_price,provider_last_update,ingested_at,lock_at,response_sha256)
 SELECT run_id,raw_response_id,'fanduel',provider_event_id,player_name,stat,market_key,line,over_price,under_price,
 provider_last_update,'2026-11-10T00:00:00Z',lock_at,response_sha256 FROM public.props_book_quotes LIMIT 1$$,'PROPS_BOOK_QUOTE_CHRONOLOGY');
SELECT props_test.raises($$INSERT INTO public.props_book_quotes(run_id,raw_response_id,bookmaker_key,provider_event_id,player_name,stat,market_key,line,
 over_price,under_price,provider_last_update,ingested_at,lock_at,response_sha256)
 SELECT run_id,raw_response_id,'fanduel',provider_event_id,player_name,stat,market_key,line,over_price,under_price,
 '2026-11-09T15:00:00Z',ingested_at,lock_at,response_sha256 FROM public.props_book_quotes LIMIT 1$$,'PROPS_BOOK_QUOTE_CHRONOLOGY');
SELECT props_test.raises($$INSERT INTO public.props_book_quotes(run_id,raw_response_id,bookmaker_key,provider_event_id,player_name,stat,market_key,line,
 over_price,under_price,provider_last_update,ingested_at,lock_at,response_sha256)
 SELECT run_id,raw_response_id,'prizepicks',provider_event_id,player_name,stat,market_key,line,over_price,under_price,
 provider_last_update,ingested_at,lock_at,response_sha256 FROM public.props_book_quotes LIMIT 1$$,'check constraint');

-- 3. One market view per observation, valid probability and flags only.
INSERT INTO public.props_market_views(observation_id,run_id,books_at_same_line,p_more_books,nearest_book_line,line_gap,flags)
 VALUES(:mobs,:mrun,1,0.5798,24.5,0,'{pros_disagree}');
SELECT props_test.raises(format($$INSERT INTO public.props_market_views(observation_id,run_id,books_at_same_line,p_more_books,nearest_book_line,line_gap,flags)
 VALUES(%s,%s,0,NULL,NULL,NULL,'{}')$$,:mobs,:mrun),'duplicate key');
SELECT props_test.raises(format($$INSERT INTO public.props_market_views(observation_id,run_id,books_at_same_line,p_more_books,nearest_book_line,line_gap,flags)
 VALUES(%s,%s,1,1.2,24.5,0,'{}')$$,:mobs,:mrun),'check constraint');
SELECT props_test.raises(format($$INSERT INTO public.props_market_views(observation_id,run_id,books_at_same_line,p_more_books,nearest_book_line,line_gap,flags)
 VALUES(%s,%s,0,NULL,NULL,NULL,'{hot_tip}')$$,:mobs,:mrun),'check constraint');

-- 4. Append-only for everyone; no access for anon.
SELECT props_test.raises($$UPDATE public.props_book_quotes SET line=1$$,'permission denied');
RESET ROLE;
SELECT props_test.raises($$UPDATE public.props_book_quotes SET line=1$$,'PROPS_IMMUTABLE');
SELECT props_test.raises($$DELETE FROM public.props_market_views$$,'PROPS_IMMUTABLE');
SET ROLE anon;
SELECT props_test.raises($$SELECT count(*) FROM public.props_book_quotes$$,'permission denied');
SELECT props_test.raises($$SELECT count(*) FROM public.props_market_views$$,'permission denied');
RESET ROLE;

-- 5. A view computed at/after lock, or from a finished run, is refused.
SET ROLE service_role;
SELECT props_test.at('2026-11-10T00:00:01Z');
SELECT props_test.raises(format($$INSERT INTO public.props_market_views(observation_id,run_id,books_at_same_line,p_more_books,nearest_book_line,line_gap,flags)
 VALUES(%s,%s,0,NULL,NULL,NULL,'{}')$$,:mobs,:mrun),'PROPS_');
RESET ROLE;
SELECT 'PROPS_MARKET_V1_SQL_TESTS_PASS' AS result;
