import test from "node:test";
import assert from "node:assert/strict";
import { buildSnapshotRows, ODDS_CONFLICT_COLUMNS } from "./snapshot-rows.ts";

const observedAt = "2026-10-08T11:58:00.000Z";
const price = {
  sportsbook: "book-one",
  market: "h2h",
  selection: "Boston Celtics",
  observedAt,
  americanOdds: -110,
};

test("unique columns exactly match the applied database constraint", () => {
  assert.equal(ODDS_CONFLICT_COLUMNS, "game_id,provider,sportsbook,market,selection,observed_at,american_odds,line");
});

test("repeating the same observation within one batch writes only one candidate", () => {
  const rows = buildSnapshotRows(123, [price, { ...price }, price]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    game_id: 123, provider: "the_odds_api", sportsbook: "book-one",
    market: "h2h", selection: "Boston Celtics", observed_at: observedAt,
    american_odds: -110, line: null,
  });
});

test("different timestamps and different odds stay as independent history", () => {
  const rows = buildSnapshotRows(123, [
    price, { ...price, observedAt: "2026-10-08T11:59:00.000Z" },
    { ...price, americanOdds: -115 },
  ]);
  assert.equal(rows.length, 3);
});

test("different game, sportsbook and outcome never collapse", () => {
  assert.equal(buildSnapshotRows(124, [price]).length, 1);
  assert.equal(buildSnapshotRows(123, [
    price, { ...price, sportsbook: "book-two" },
    { ...price, selection: "New York Knicks" },
  ]).length, 3);
});

test("empty input stays empty and does not invent history", () => {
  assert.deepEqual(buildSnapshotRows(44, []), []);
});

test("unsafe or missing game identifier is rejected", () => {
  for (const bad of [0, -1, 2.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => buildSnapshotRows(bad, [price]), /Invalid stored game ID/);
  }
});

test("invalid source odds, timestamps and outcome labels fail closed", () => {
  const invalid = [
    { ...price, americanOdds: 99 },
    { ...price, americanOdds: -99 },
    { ...price, americanOdds: NaN },
    { ...price, observedAt: "2026-10-08" },
    { ...price, observedAt: "bad" },
    { ...price, selection: " " },
    { ...price, sportsbook: "" },
    { ...price, market: "spreads" },
  ];
  for (const bad of invalid) {
    assert.throws(() => buildSnapshotRows(123, [bad]), /Invalid odds snapshot record/);
  }
});
