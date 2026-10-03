/*
 * Scratches, dents and the rest, marked on the same four
 * outline drawings of the car the paper agreement carries.
 *
 * A mark is a point on one view, stored as a fraction of the
 * drawing's width and height so it lands in the same place
 * whatever size the drawing is shown or printed at.
 */

export const DAMAGE_VIEWS = [
  {
    view: "front",
    label: "FRONT",
    src: "/brand/vehicle-diagrams/front.png",
  },
  {
    view: "back",
    label: "BACK",
    src: "/brand/vehicle-diagrams/back.png",
  },
  {
    view: "left",
    label: "LEFT",
    src: "/brand/vehicle-diagrams/left.png",
  },
  {
    view: "right",
    label: "RIGHT",
    src: "/brand/vehicle-diagrams/right.png",
  },
] as const;

export type DamageView =
  (typeof DAMAGE_VIEWS)[number]["view"];

/* The letter is what is drawn on the diagram and printed. */
export const DAMAGE_KINDS = [
  { kind: "scratch", label: "Scratch", letter: "S" },
  { kind: "dent", label: "Dent", letter: "D" },
  { kind: "chip", label: "Chip / crack", letter: "C" },
  { kind: "other", label: "Other", letter: "X" },
] as const;

export type DamageKind =
  (typeof DAMAGE_KINDS)[number]["kind"];

export type DamageMark = {
  id: string;
  view: DamageView;
  /* 0–1 across and down the drawing. */
  x: number;
  y: number;
  kind: DamageKind;
  /* When the mark was first made, as an ISO timestamp. */
  notedAt: string;
};

/*
 * A firm limit keeps a rental document well inside the
 * Firestore size limit however enthusiastic the inspection.
 */
export const MAX_DAMAGE_MARKS = 80;

const VIEW_SET = new Set<string>(
  DAMAGE_VIEWS.map((entry) => entry.view),
);

const KIND_SET = new Set<string>(
  DAMAGE_KINDS.map((entry) => entry.kind),
);

export function damageKindOf(kind: DamageKind) {
  return (
    DAMAGE_KINDS.find(
      (entry) => entry.kind === kind,
    ) ?? DAMAGE_KINDS[DAMAGE_KINDS.length - 1]
  );
}

export function damageViewLabel(
  view: DamageView,
): string {
  return (
    DAMAGE_VIEWS.find(
      (entry) => entry.view === view,
    )?.label ?? view.toUpperCase()
  );
}

function fraction(value: unknown): number | null {
  const number = Number(value);

  if (
    !Number.isFinite(number) ||
    number < 0 ||
    number > 1
  ) {
    return null;
  }

  return Math.round(number * 10_000) / 10_000;
}

/*
 * Reads a list of marks from a form or a stored document.
 * Anything malformed is dropped rather than refused when
 * reading back, and refused when `strict` is set, so a bad
 * submission fails loudly but an old record still opens.
 */
export function sanitizeDamageMarks(
  value: unknown,
  { strict = false }: { strict?: boolean } = {},
): DamageMark[] {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value)) {
    if (strict) {
      throw new Error(
        "The damage marks could not be read.",
      );
    }

    return [];
  }

  if (strict && value.length > MAX_DAMAGE_MARKS) {
    throw new Error(
      `Mark at most ${MAX_DAMAGE_MARKS} areas of damage.`,
    );
  }

  const marks: DamageMark[] = [];

  const seen = new Set<string>();

  for (const item of value.slice(
    0,
    MAX_DAMAGE_MARKS,
  )) {
    const entry = (item ?? {}) as Record<
      string,
      unknown
    >;

    const id = String(entry.id ?? "").trim();

    const view = String(entry.view ?? "");

    const kind = String(entry.kind ?? "");

    const x = fraction(entry.x);

    const y = fraction(entry.y);

    const notedAt = String(entry.notedAt ?? "");

    const valid =
      id.length > 0 &&
      id.length <= 64 &&
      !seen.has(id) &&
      VIEW_SET.has(view) &&
      KIND_SET.has(kind) &&
      x !== null &&
      y !== null &&
      !Number.isNaN(Date.parse(notedAt));

    if (!valid) {
      if (strict) {
        throw new Error(
          "One of the damage marks could not be read. Remove it and mark it again.",
        );
      }

      continue;
    }

    seen.add(id);

    marks.push({
      id,
      view: view as DamageView,
      x: x!,
      y: y!,
      kind: kind as DamageKind,
      notedAt: new Date(notedAt).toISOString(),
    });
  }

  return marks;
}

export function newDamageMarkId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

const DAMAGE_NAMES: Record<
  DamageKind,
  [string, string]
> = {
  scratch: ["scratch", "scratches"],
  dent: ["dent", "dents"],
  chip: ["chip / crack", "chips / cracks"],
  other: ["other mark", "other marks"],
};

/* "2 scratches, 1 dent" — for notices and lists. */
export function summariseDamage(
  marks: DamageMark[],
): string {
  if (marks.length === 0) {
    return "No damage marked";
  }

  return DAMAGE_KINDS.map(({ kind }) => {
    const count = marks.filter(
      (mark) => mark.kind === kind,
    ).length;

    if (count === 0) {
      return null;
    }

    const [one, many] = DAMAGE_NAMES[kind];

    return `${count} ${count === 1 ? one : many}`;
  })
    .filter(Boolean)
    .join(", ");
}
