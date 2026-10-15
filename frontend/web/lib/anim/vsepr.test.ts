import { test } from "node:test";
import assert from "node:assert/strict";
import { vseprIssues } from "../canvas/vsepr";
import type { MoleculeStage } from "../canvas/types";

const star = (label: string, centre: string, others: number, lonePairs: number | undefined, geometry: string, bondAngle?: string): MoleculeStage => ({
  kind: "molecule",
  molecules: [{
    id: label.toLowerCase(), label, geometry, bondAngle, s: 0,
    atoms: [{ id: "c", element: centre, x: 0, y: 0, z: 0, lonePairs }, ...Array.from({ length: others }, (_, i) => ({ id: `h${i}`, element: "H", x: 0.5, y: 0, z: 0 }))],
    bonds: Array.from({ length: others }, (_, i) => ({ from: "c", to: `h${i}`, order: 1 as const })),
  }],
});

test("correct VSEPR shapes and angles pass", () => {
  assert.deepEqual(vseprIssues(star("CH4", "C", 4, 0, "tetrahedral", "109.5°")), []);
  assert.deepEqual(vseprIssues(star("NH3", "N", 3, 1, "trigonal pyramidal", "107°")), []);
  assert.deepEqual(vseprIssues(star("H2O", "O", 2, 2, "bent (V-shaped)", "104.5°")), []);
  assert.deepEqual(vseprIssues(star("H2S", "S", 2, 2, "bent", "92°")), []);
});

test("a wrong shape or an impossible angle is caught", () => {
  assert.equal(vseprIssues(star("NH3", "N", 3, 1, "trigonal planar", "107°")).length, 1);
  assert.equal(vseprIssues(star("H2O", "O", 2, 2, "bent", "120°")).length, 1);
  assert.equal(vseprIssues(star("CH4", "C", 4, 0, "tetrahedral", "90°")).length, 1);
});

test("unknown lone pairs are not judged", () => {
  assert.deepEqual(vseprIssues(star("NH3", "N", 3, undefined, "trigonal planar")), []);
});
