"""Disposable localhost PostgreSQL contracts; never accepts a hosted database.

Dependency for this test only: psycopg[binary]==3.3.9.
KALSHI_TEST_DATABASE_URL identifies a disposable LOCAL PostgreSQL service.
The script creates a uniquely named test database and drops only that database.
"""
import concurrent.futures
import datetime as dt
import json
import os
import pathlib
import threading
import uuid
from urllib.parse import urlparse

import psycopg
from psycopg import sql


def verify():
    url = os.environ.get("KALSHI_TEST_DATABASE_URL", "postgresql://postgres@127.0.0.1:56192/postgres")
    parsed = urlparse(url)
    assert parsed.scheme in ("postgres", "postgresql") and parsed.hostname in ("127.0.0.1", "localhost"), "LOCAL_TEST_DATABASE_REQUIRED"
    db = "kalshi_test_" + uuid.uuid4().hex[:16]
    admin = psycopg.connect(url, autocommit=True)
    test_url = parsed._replace(path="/" + db).geturl()
    admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(db)))
    conn = None
    try:
        conn = psycopg.connect(test_url, autocommit=True)
        for role in ("anon", "authenticated", "service_role"):
            if not conn.execute("SELECT 1 FROM pg_roles WHERE rolname=%s", (role,)).fetchone():
                conn.execute(sql.SQL("CREATE ROLE {} {}").format(sql.Identifier(role), sql.SQL("BYPASSRLS" if role == "service_role" else "")))
        conn.execute("GRANT USAGE ON SCHEMA public TO service_role")
        conn.execute("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role")
        root = pathlib.Path(__file__).resolve().parents[1]
        conn.execute((root / "database/kalshi/kalshi_paper_platform_v1.sql").read_text())
        conn.execute("""CREATE FUNCTION public.test_claim_demo_intent(t text,s text,p bigint,c timestamptz,k text,f text)
        RETURNS public.kalshi_demo_intents LANGUAGE sql AS $$
        SELECT public.kalshi_claim_demo_intent(t,s,p,c,k,f,jsonb_build_object('source','KALSHI_DEMO','ticker',t)::text) $$""")

        def refused(statement, args=(), message=None):
            try:
                with conn.transaction():
                    conn.execute(statement, args)
            except psycopg.Error as error:
                if message:
                    assert message in str(error), str(error)
                return
            raise AssertionError("Expected SQL refusal: " + statement)

        tables = conn.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'kalshi_%'").fetchall()
        assert len(tables) == 10
        for (table,) in tables:
            assert conn.execute("SELECT relrowsecurity FROM pg_class WHERE oid=%s::regclass", ("public." + table,)).fetchone()[0]
            for role in ("anon", "authenticated"):
                for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"):
                    assert not conn.execute("SELECT has_table_privilege(%s,%s,%s)", (role, "public." + table, privilege)).fetchone()[0]
            for privilege in ("DELETE", "TRUNCATE"):
                assert not conn.execute("SELECT has_table_privilege('service_role',%s,%s)", ("public." + table, privilege)).fetchone()[0]
            if table not in ("kalshi_platform_runs", "kalshi_demo_control"):
                assert not conn.execute("SELECT has_table_privilege('service_role',%s,'UPDATE')", ("public." + table,)).fetchone()[0]
        assert not conn.execute("SELECT has_function_privilege('anon','public.kalshi_begin_run(text)','EXECUTE')").fetchone()[0]
        refused("UPDATE public.kalshi_platform_version SET version='forged'", message="KALSHI_IMMUTABLE")
        with conn.transaction():
            conn.execute("SET LOCAL ROLE service_role")
            assert conn.execute("SELECT version FROM public.kalshi_platform_version").fetchone()[0] == "kalshi-paper-platform-v1"
        conn.execute("SET ROLE service_role")

        start = conn.execute("SELECT kalshi_begin_run('tick-2026-11-20T20:00')").fetchone()[0]
        assert start["claimed"]
        assert not conn.execute("SELECT kalshi_begin_run('tick-2026-11-20T20:00')").fetchone()[0]["claimed"]
        conn.execute("SELECT kalshi_finish_run(%s,%s,'COMPLETED','{}')", (start["id"], start["token"]))
        assert not conn.execute("SELECT kalshi_begin_run('tick-2026-11-20T20:00')").fetchone()[0]["claimed"]
        old = conn.execute("SELECT kalshi_begin_run('tick-2026-11-20T21:00')").fetchone()[0]
        conn.execute("UPDATE kalshi_platform_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=%s", (old["id"],))
        fresh = conn.execute("SELECT kalshi_begin_run('tick-2026-11-20T21:00')").fetchone()[0]
        assert fresh["id"] != old["id"]
        refused("SELECT kalshi_finish_run(%s,%s,'COMPLETED','{}')", (old["id"], old["token"]), "KALSHI_LEASE_LOST")

        journal = [{"payload": {"config": {"id": "fixture", "mode": "OFFLINE_FIXTURE"}}}]
        encoded = json.dumps(journal)
        assert conn.execute("SELECT kalshi_save_fixture_ledger('fixture',0,%s)", (encoded,)).fetchone()[0] == 1
        assert conn.execute("SELECT kalshi_save_fixture_ledger('fixture',0,%s)", (encoded,)).fetchone()[0] == 1
        journal.append({"payload": {"type": "control"}})
        refused("SELECT kalshi_save_fixture_ledger('fixture',0,%s)", (json.dumps(journal),), "KALSHI_REVISION_CONFLICT")
        assert conn.execute("SELECT kalshi_save_fixture_ledger('fixture',1,%s)", (json.dumps(journal),)).fetchone()[0] == 2
        journal[0]["payload"]["config"]["id"] = "forged"
        refused("SELECT kalshi_save_fixture_ledger('fixture',2,%s)", (json.dumps(journal),), "KALSHI_FIXTURE_ONLY")
        journal[0]["payload"]["config"]["id"] = "fixture"
        journal[0]["changed"] = True
        refused("SELECT kalshi_save_fixture_ledger('fixture',2,%s)", (json.dumps(journal),), "KALSHI_IMMUTABLE")
        refused("SELECT kalshi_save_fixture_ledger('missing',0,'[{}]')", message="KALSHI_FIXTURE_ONLY")

        now = dt.datetime.now(dt.timezone.utc)
        target = (now - dt.timedelta(hours=5)).date() + dt.timedelta(days=1)
        document = {"schemaVersion": "kalshi-weather-contract-forecast-v1", "id": "a" * 64,
                    "modelId": "test-v1", "marketDataUsed": False, "asOf": now.isoformat(), "input": {"targetLocalDate": target.isoformat()}}
        assert conn.execute("SELECT kalshi_record_contract_forecast(%s)", (json.dumps(document),)).fetchone()[0] == "a" * 64
        document["id"] = "b" * 64
        assert conn.execute("SELECT kalshi_record_contract_forecast(%s)", (json.dumps(document),)).fetchone()[0] == "a" * 64
        document["modelId"] = "test-v2"
        document["asOf"] = (now - dt.timedelta(days=1)).isoformat()
        refused("SELECT kalshi_record_contract_forecast(%s)", (json.dumps(document),), "KALSHI_NOT_FORWARD")

        fingerprint = "a" * 64
        close = now + dt.timedelta(hours=2)
        def claim(ticker):
            return conn.execute("SELECT (test_claim_demo_intent(%s,'yes',440000,%s,'SMOKE',%s)).id", (ticker, close, fingerprint)).fetchone()[0]
        refused("SELECT test_claim_demo_intent('KXHIGHNY-26NOV20-T55','yes',440000,%s,'SMOKE',%s)", (close, fingerprint), "KALSHI_DEMO_NOT_ARMED")
        conn.execute("SELECT kalshi_set_demo_control('ARMED',%s)", (fingerprint,))
        conn.execute("UPDATE kalshi_demo_control SET checked_at=clock_timestamp()-interval '27 hours'")
        refused("SELECT test_claim_demo_intent('KXHIGHNY-26NOV20-T55','yes',440000,%s,'SMOKE',%s)", (close, fingerprint), "KALSHI_DEMO_NOT_ARMED")
        conn.execute("SELECT kalshi_note_demo_check(%s)", (fingerprint,))
        first = claim("KXHIGHNY-26NOV20-T55")
        refused("SELECT test_claim_demo_intent('KXHIGHNY-26NOV20-T56','yes',440000,%s,'SMOKE',%s)", (close, fingerprint), "KALSHI_DEMO_RECONCILE_REQUIRED")
        def acknowledge(intent):
            conn.execute("INSERT INTO kalshi_demo_receipts(intent_id,kind,document) VALUES(%s,'ACKNOWLEDGED','{}') ON CONFLICT DO NOTHING", (intent,))
        acknowledge(first)
        barrier = threading.Barrier(2)
        def concurrent_claim():
            with psycopg.connect(test_url, autocommit=True) as other:
                barrier.wait()
                try:
                    return other.execute("SELECT (test_claim_demo_intent('KXHIGHNY-26NOV20-T56','yes',440000,%s,'SMOKE',%s)).id", (close, fingerprint)).fetchone()[0]
                except psycopg.Error as error:
                    assert "KALSHI_DEMO_ALREADY_ATTEMPTED" in str(error), str(error)
                    return None
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: concurrent_claim(), range(2)))
        assert sum(r is not None for r in results) == 1
        acknowledge(next(r for r in results if r is not None))
        third = claim("KXHIGHNY-26NOV20-T57")
        acknowledge(third)
        refused("SELECT test_claim_demo_intent('KXHIGHNY-26NOV20-T58','yes',440000,%s,'SMOKE',%s)", (close, fingerprint), "KALSHI_DEMO_DAILY_LIMIT")
        assert conn.execute("SELECT count(*) FROM kalshi_demo_receipts WHERE intent_id=%s", (first,)).fetchone()[0] == 1
        acknowledge(first)
        assert conn.execute("SELECT count(*) FROM kalshi_demo_receipts WHERE intent_id=%s", (first,)).fetchone()[0] == 1
        conn.execute("SELECT kalshi_set_demo_control('STOPPED',NULL)")
        refused("SELECT kalshi_note_demo_check(%s)", (fingerprint,), "KALSHI_DEMO_NOT_ARMED")
        assert conn.execute("SELECT state FROM kalshi_demo_control").fetchone()[0] == "STOPPED"
        print("KALSHI_PLATFORM_SQL_PASS: grants, RLS, immutable history, leases, forward clock, CAS, demo controls, duplicate/concurrent attempts and caps")
    finally:
        if conn:
            conn.close()
        admin.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(db)))
        admin.close()


if __name__ == "__main__":
    verify()
