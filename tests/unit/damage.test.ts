import { describe, expect, it } from "vitest";

import {
  MAX_DAMAGE_MARKS,
  sanitizeDamageMarks,
  summariseDamage,
  type DamageMark,
} from "@/lib/damage";

const mark = (
  overrides: Partial<DamageMark> = {},
): DamageMark => ({
  id: "mark-1",
  view: "left",
  x: 0.25,
  y: 0.5,
  kind: "scratch",
  notedAt: "2026-10-03T10:00:00.000Z",
  ...overrides,
});

describe("damage marks", () => {
  it("keeps a well-formed mark as it was drawn", () => {
    expect(sanitizeDamageMarks([mark()])).toEqual([
      mark(),
    ]);
  });

  it("reads a missing list as no damage", () => {
    expect(sanitizeDamageMarks(undefined)).toEqual([]);
    expect(sanitizeDamageMarks(null)).toEqual([]);
  });

  it("drops a malformed stored mark so an old record still opens", () => {
    expect(
      sanitizeDamageMarks([
        mark(),
        mark({ id: "mark-2", x: 1.4 }),
        { ...mark({ id: "mark-3" }), view: "roof" },
        mark({ id: "mark-1" }),
      ]),
    ).toEqual([mark()]);
  });

  it("refuses a malformed submission outright", () => {
    expect(() =>
      sanitizeDamageMarks(
        [{ ...mark(), kind: "rust" }],
        { strict: true },
      ),
    ).toThrow("could not be read");

    expect(() =>
      sanitizeDamageMarks("scratch", {
        strict: true,
      }),
    ).toThrow("could not be read");
  });

  it("caps how many marks one form can carry", () => {
    const many = Array.from(
      { length: MAX_DAMAGE_MARKS + 1 },
      (_, index) => mark({ id: `mark-${index}` }),
    );

    expect(() =>
      sanitizeDamageMarks(many, { strict: true }),
    ).toThrow(`at most ${MAX_DAMAGE_MARKS}`);
  });

  it("summarises the damage by kind", () => {
    expect(
      summariseDamage([
        mark(),
        mark({ id: "b" }),
        mark({ id: "c", kind: "dent" }),
      ]),
    ).toBe("2 scratches, 1 dent");

    expect(summariseDamage([])).toBe(
      "No damage marked",
    );
  });
});
