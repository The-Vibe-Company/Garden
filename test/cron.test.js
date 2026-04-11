import test from "node:test";
import assert from "node:assert/strict";
import { matchesCron } from "../src/cron.js";

test("matchesCron supports stars, lists, ranges, and steps", () => {
  const date = new Date("2026-04-11T08:15:00");

  assert.equal(matchesCron(date, "15 8 * * *"), true);
  assert.equal(matchesCron(date, "*/5 8 * * *"), true);
  assert.equal(matchesCron(date, "10-20 8 * * *"), true);
  assert.equal(matchesCron(date, "14,15,16 8 * * *"), true);
  assert.equal(matchesCron(date, "0 8 * * *"), false);
});
