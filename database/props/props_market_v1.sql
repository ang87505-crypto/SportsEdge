-- SportsEdge props market v1 (2026-11-08). Additive and append-only: sportsbook prop quotes received
-- in the same collect reply as PrizePicks/Pick6 lines, and one computed market view per observation.
-- Professional-market reference data only: no account, no entry, no real money. Requires props_v1.sql.
BEGIN;

CREATE TABLE public.props_book_quotes(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 run_id bigint NOT NULL REFERENCES public.props_runs(id),
 raw_response_id bigint NOT NULL REFERENCES public.props_raw_responses(id),
 bookmaker_key text NOT NULL CHECK(bookmaker_key IN ('draftkings','fanduel','betmgm','williamhill_us')),
 provider_event_id text NOT NULL CHECK(provider_event_id ~ '^[A-Za-z0-9_-]{6,80}$'),
 player_name text NOT NULL CHECK(length(player_name) BETWEEN 1 AND 120),
 stat text NOT NULL CHECK(stat IN ('points','rebounds','assists')),
 market_key text NOT NULL CHECK(market_key IN ('player_points','player_rebounds','player_assists')),
 line numeric NOT NULL CHECK(line BETWEEN 0.5 AND 99.5 AND line*2=round(line*2)),
 over_price integer NOT NULL CHECK(over_price<=-100 OR over_price>=100),
 under_price integer NOT NULL CHECK(under_price<=-100 OR under_price>=100),
 provider_last_update timestamptz NOT NULL,
 ingested_at timestamptz NOT NULL,
 lock_at timestamptz NOT NULL,
 response_sha256 text NOT NULL CHECK(response_sha256 ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT public.props_now(),
 UNIQUE(bookmaker_key,provider_event_id,market_key,player_name,line,provider_last_update)
);
CREATE INDEX props_book_quotes_event ON public.props_book_quotes(provider_event_id,market_key);

CREATE TABLE public.props_market_views(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 observation_id bigint NOT NULL UNIQUE REFERENCES public.props_observations(id),
 run_id bigint NOT NULL REFERENCES public.props_runs(id),
 books_at_same_line integer NOT NULL CHECK(books_at_same_line BETWEEN 0 AND 10),
 p_more_books numeric CHECK(p_more_books BETWEEN 0 AND 1),
 nearest_book_line numeric,
 line_gap numeric,
 flags text[] NOT NULL DEFAULT '{}' CHECK(flags <@ ARRAY['lagging_line','pros_disagree']::text[]),
 computed_at timestamptz NOT NULL DEFAULT public.props_now(),
 CHECK((books_at_same_line=0)=(p_more_books IS NULL)),
 CHECK((nearest_book_line IS NULL)=(line_gap IS NULL))
);

-- Same chronology as observations: live run, before lock, quote at most 2 h old, never backdated.
CREATE FUNCTION public.props_check_book_quote() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.props_require_running(NEW.run_id);
 NEW.recorded_at:=public.props_now();
 IF NEW.ingested_at>NEW.recorded_at OR NEW.ingested_at>=NEW.lock_at OR NEW.recorded_at>=NEW.lock_at
  OR NEW.provider_last_update>NEW.ingested_at+interval '60 seconds'
  OR NEW.provider_last_update<NEW.ingested_at-interval '2 hours'
  OR NEW.provider_last_update>=NEW.lock_at THEN
  RAISE EXCEPTION 'PROPS_BOOK_QUOTE_CHRONOLOGY';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER props_book_quote_chronology BEFORE INSERT ON public.props_book_quotes
 FOR EACH ROW EXECUTE FUNCTION public.props_check_book_quote();

CREATE FUNCTION public.props_check_market_view() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE lock timestamptz;
BEGIN
 PERFORM public.props_require_running(NEW.run_id);
 NEW.computed_at:=public.props_now();
 SELECT lock_at INTO lock FROM public.props_observations WHERE id=NEW.observation_id;
 IF lock IS NULL OR NEW.computed_at>=lock THEN RAISE EXCEPTION 'PROPS_MARKET_VIEW_CHRONOLOGY'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER props_market_view_chronology BEFORE INSERT ON public.props_market_views
 FOR EACH ROW EXECUTE FUNCTION public.props_check_market_view();

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['props_book_quotes','props_market_views'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT,INSERT ON public.%I TO service_role',t);
  EXECUTE format('CREATE TRIGGER props_append_only BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.props_immutable()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['props_check_book_quote()','props_check_market_view()'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC,anon,authenticated',t);
 END LOOP;
END $$;
COMMIT;
