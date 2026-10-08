import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOdds, oddsIdentity, TRACKS } from "./normalize.ts";

const NOW = new Date("2026-10-08T12:00:00.000Z");
const matchTime = "2026-10-09T20:00:00Z";
const update = "2026-10-08T11:58:00Z";
const nba = (extra = {}) => ({
  id: "nba-1", sport_key: "basketball_nba",
  commence_time: matchTime, home_team: "Boston Celtics", away_team: "New York Knicks",
  bookmakers: [{
    key: "book-one", title: "Book One", markets: [{
      key: "h2h", last_update: update,
      outcomes: [{ name: "Boston Celtics", price: -110 }, { name: "New York Knicks", price: 100 }],
    }],
  }], ...extra,
});
const epl = (extra = {}) => ({
  id: "soccer-1", sport_key: "soccer_epl",
  commence_time: matchTime, home_team: "Arsenal", away_team: "Chelsea",
  bookmakers: [{
    key: "book-two", markets: [{
      key: "h2h", last_update: update,
      outcomes: [{ name: "Arsenal", price: 135 }, { name: "Chelsea", price: 210 }, { name: "Draw", price: 245 }],
    }],
  }], ...extra,
});

test("NBA normalizer captures exactly two valid pregame moneyline prices", () => {
  const output = normalizeOdds([nba()], "nba", NOW);
  assert.equal(output.games.length, 1);
  assert.equal(output.games[0].prices.length, 2);
  assert.deepEqual(output.games[0].prices.map(p => p.selection), ["Boston Celtics", "New York Knicks"]);
  assert.equal(output.games[0].prices[0].observedAt, "2026-10-08T11:58:00.000Z");
  assert.equal(output.games[0].sourceUpdatedAt, "2026-10-08T11:58:00.000Z");
  assert.equal(output.invalidEvents, 0);
});

test("soccer is a separate EPL track and includes the draw", () => {
  const output = normalizeOdds([epl()], "soccer", NOW);
  assert.equal(TRACKS.soccer.sourceSportKey, "soccer_epl");
  assert.equal(output.games[0].prices.length, 3);
  assert.deepEqual(output.games[0].prices.map(p => p.selection), ["Arsenal", "Chelsea", "Draw"]);
});

test("wrong-provider sport key is never silently relabeled", () => {
  const output = normalizeOdds([epl()], "nba", NOW);
  assert.equal(output.games.length, 0);
  assert.equal(output.invalidEvents, 1);
});

test("matches in play or already started cannot become pregame odds", () => {
  const output = normalizeOdds([nba({ commence_time: "2026-10-08T11:00:00Z" })], "nba", NOW);
  assert.equal(output.games.length, 0);
  assert.equal(output.skippedLiveOrPast, 1);
});

test("rejects stale timestamp semantics: source odds seen after kickoff", () => {
  const game = nba();
  game.bookmakers[0].markets[0].last_update = "2026-10-09T21:00:00Z";
  const output = normalizeOdds([game], "nba", NOW);
  assert.equal(output.games.length, 1);
  assert.equal(output.games[0].prices.length, 0);
  assert.equal(output.skippedMarkets, 1);
});

test("incomplete soccer h2h market is never treated as a three-way probability market", () => {
  const game = epl();
  game.bookmakers[0].markets[0].outcomes.pop();
  const output = normalizeOdds([game], "soccer", NOW);
  assert.equal(output.games[0].prices.length, 0);
  assert.equal(output.skippedMarkets, 1);
});

test("invalid American odds fail closed without inventing a price", () => {
  const game = nba();
  game.bookmakers[0].markets[0].outcomes[0].price = 99;
  const output = normalizeOdds([game], "nba", NOW);
  assert.equal(output.games[0].prices.length, 0);
  assert.equal(output.skippedMarkets, 1);
});

test("missing market-level last_update is not replaced by bookmaker deprecated timestamp", () => {
  const game = nba();
  game.bookmakers[0].last_update = update;
  delete game.bookmakers[0].markets[0].last_update;
  const output = normalizeOdds([game], "nba", NOW);
  assert.equal(output.games[0].prices.length, 0);
  assert.equal(output.skippedMarkets, 1);
});

test("event duplicated by provider ID is rejected and no duplicate price is produced", () => {
  const output = normalizeOdds([nba(), nba()], "nba", NOW);
  assert.equal(output.games.length, 1);
  assert.equal(output.invalidEvents, 1);
  assert.equal(output.games[0].prices.length, 2);
});

test("identical sportsbook price snapshots have identical stable identity", () => {
  const output = normalizeOdds([nba()], "nba", NOW);
  const price = output.games[0].prices[0];
  assert.equal(oddsIdentity("nba-1", price), oddsIdentity("nba-1", { ...price }));
  assert.notEqual(oddsIdentity("nba-1", price), oddsIdentity("nba-1", { ...price, americanOdds: -115 }));
});

test("no fabricated odds are emitted for events without a supported market", () => {
  const output = normalizeOdds([nba({ bookmakers: [] })], "nba", NOW);
  assert.equal(output.games.length, 1);
  assert.deepEqual(output.games[0].prices, []);
});

test("malformed provider response returns an explicit error", () => {
  assert.throws(() => normalizeOdds({ bad: true }, "nba", NOW), /array/);
});

test("invalid event timestamps and team names are rejected", () => {
  const output = normalizeOdds([nba({ commence_time: "not-a-date" }), nba({ home_team: "" })], "nba", NOW);
  assert.equal(output.invalidEvents, 2);
  assert.equal(output.games.length, 0);
});
