import assert from "node:assert/strict";
import { test } from "node:test";
import { parseXml } from "../dist/xml.js";
import { CLIP_ONLY_TRK, MINIMAL_TRK } from "./helpers/trk.js";

const PANEL = "org.opensourcephysics.cabrillo.tracker.TrackerPanel";

test("parseXml rejects skipped bytes and sibling text", () => {
  const bad = [
    `<<<object class="${PANEL}"></object>`,
    `<object class="${PANEL}"><!!!garbage!!!></object>`,
    `<object class="${PANEL}"></object><!!!`,
    `prefix<object class="${PANEL}"></object>`,
    `<object class="${PANEL}"></object>suffix`,
  ];
  for (const xml of bad) {
    assert.throws(() => parseXml(xml), Error, xml);
  }
});

test("parseXml still accepts fixture documents", () => {
  assert.equal(parseXml(MINIMAL_TRK).attrs.class, PANEL);
  assert.equal(parseXml(CLIP_ONLY_TRK).attrs.class, PANEL);
});
