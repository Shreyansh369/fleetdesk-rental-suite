import { Timestamp } from "firebase/firestore";

/*
 * An in-browser stand-in for the slice of the Firestore Web SDK
 * the workspace uses: references, transactions, filtered and
 * ordered queries with cursors, and live listeners.
 *
 * It exists so the demo runs the same workflow code as a live
 * workspace — every booking, checkout, return and payment goes
 * through lib/services/firestore-client.ts unchanged — with the
 * data kept on the visitor's device instead of in Firebase.
 *
 * The semantics follow Firestore where the workflows depend on
 * them: a transaction retries when a document it read changed
 * before it committed, `update` refuses a missing document, a
 * write containing undefined is refused, a filter or ordering on
 * a field excludes documents without that field, and ties are
 * broken by document id. Values are stored as Firestore would
 * return them, so a timestamp reads back as a real Timestamp.
 *
 * Security rules are not emulated. The demo belongs to whoever
 * is holding the browser; the role checks the screens make still
 * apply, and the live workspace keeps the rules as its boundary.
 */

type Data = Record<string, unknown>;

type StoredDocument = {
  data: Data;
  version: number;
};

export const LOCAL_MARKER = "__fleetdeskLocal";

const SENTINEL = "__fleetdeskSentinel";

type Sentinel = {
  [SENTINEL]: "serverTimestamp" | "deleteField";
};

export function localServerTimestamp(): Sentinel {
  return { [SENTINEL]: "serverTimestamp" };
}

export function localDeleteField(): Sentinel {
  return { [SENTINEL]: "deleteField" };
}

function sentinelOf(
  value: unknown,
): Sentinel[typeof SENTINEL] | null {
  return value !== null &&
    typeof value === "object" &&
    SENTINEL in value
    ? (value as Sentinel)[SENTINEL]
    : null;
}

export function isLocalObject(
  value: unknown,
): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    LOCAL_MARKER in value
  );
}

/* =========================================================
   Persistence contract
   ========================================================= */

export interface LocalPersistence {
  load(): Promise<string | null>;
  save(serialized: string): Promise<void>;
  clear(): Promise<void>;
}

/* =========================================================
   Values
   ========================================================= */

function isPlainObject(
  value: unknown,
): value is Data {
  if (
    value === null ||
    typeof value !== "object"
  ) {
    return false;
  }

  const prototype =
    Object.getPrototypeOf(value);

  return (
    prototype === Object.prototype ||
    prototype === null
  );
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(cloneValue) as T;
  }

  if (isPlainObject(value)) {
    const copy: Data = {};

    for (const [key, entry] of Object.entries(value)) {
      copy[key] = cloneValue(entry);
    }

    return copy as T;
  }

  /* Timestamps are immutable, so sharing one is safe. */
  return value;
}

/*
 * Converts what a caller wrote into what Firestore would store:
 * Dates become Timestamps, the server timestamp resolves to the
 * commit time, and undefined is refused just as the SDK refuses
 * it, so a workflow bug shows up in the demo the same way it
 * would in a live workspace.
 */
function normaliseValue(
  value: unknown,
  commitTime: Timestamp,
  path: string,
): unknown {
  if (value === undefined) {
    throw new Error(
      `Function setDoc() called with invalid data. Unsupported field value: undefined (found in field ${path}).`,
    );
  }

  const sentinel = sentinelOf(value);

  if (sentinel === "serverTimestamp") {
    return commitTime;
  }

  if (sentinel === "deleteField") {
    throw new Error(
      `deleteField() can only be used with update() and set() with {merge: true} (found in field ${path}).`,
    );
  }

  if (value instanceof Date) {
    return Timestamp.fromDate(value);
  }

  if (value instanceof Timestamp) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      normaliseValue(
        entry,
        commitTime,
        `${path}.${index}`,
      ),
    );
  }

  if (
    value !== null &&
    typeof value === "object"
  ) {
    const copy: Data = {};

    for (const [key, entry] of Object.entries(
      value as Data,
    )) {
      copy[key] = normaliseValue(
        entry,
        commitTime,
        path ? `${path}.${key}` : key,
      );
    }

    return copy;
  }

  return value;
}

export function getField(
  data: Data | undefined,
  fieldPath: string,
): unknown {
  let current: unknown = data;

  for (const part of fieldPath.split(".")) {
    if (!isPlainObject(current)) {
      return undefined;
    }

    current = current[part];
  }

  return current;
}

function typeRank(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "boolean") return 1;
  if (typeof value === "number") return 2;
  if (value instanceof Timestamp) return 3;
  if (typeof value === "string") return 4;
  if (Array.isArray(value)) return 5;
  return 6;
}

export function compareValues(
  left: unknown,
  right: unknown,
): number {
  const rankDifference =
    typeRank(left) - typeRank(right);

  if (rankDifference !== 0) {
    return rankDifference;
  }

  if (typeof left === "boolean") {
    return Number(left) - Number(right);
  }

  if (typeof left === "number") {
    return left - (right as number);
  }

  if (left instanceof Timestamp) {
    return left.toMillis() - (right as Timestamp).toMillis() ||
      left.nanoseconds - (right as Timestamp).nanoseconds;
  }

  if (typeof left === "string") {
    const other = right as string;

    return left < other ? -1 : left > other ? 1 : 0;
  }

  if (Array.isArray(left)) {
    const other = right as unknown[];

    for (
      let index = 0;
      index < Math.min(left.length, other.length);
      index += 1
    ) {
      const result = compareValues(
        left[index],
        other[index],
      );

      if (result !== 0) {
        return result;
      }
    }

    return left.length - other.length;
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();

    for (
      let index = 0;
      index < Math.min(leftKeys.length, rightKeys.length);
      index += 1
    ) {
      if (leftKeys[index] !== rightKeys[index]) {
        return leftKeys[index] < rightKeys[index] ? -1 : 1;
      }

      const result = compareValues(
        left[leftKeys[index]],
        right[rightKeys[index]],
      );

      if (result !== 0) {
        return result;
      }
    }

    return leftKeys.length - rightKeys.length;
  }

  return 0;
}

function valuesEqual(
  left: unknown,
  right: unknown,
): boolean {
  return (
    typeRank(left) === typeRank(right) &&
    compareValues(left, right) === 0
  );
}

/* =========================================================
   Serialization
   ========================================================= */

function encode(value: unknown): unknown {
  if (value instanceof Timestamp) {
    return {
      __ts: [value.seconds, value.nanoseconds],
    };
  }

  if (Array.isArray(value)) {
    return value.map(encode);
  }

  if (isPlainObject(value)) {
    const copy: Data = {};

    for (const [key, entry] of Object.entries(value)) {
      copy[key] = encode(entry);
    }

    return copy;
  }

  return value;
}

function decode(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(decode);
  }

  if (isPlainObject(value)) {
    const marker = value.__ts;

    if (
      Array.isArray(marker) &&
      Object.keys(value).length === 1
    ) {
      return new Timestamp(
        Number(marker[0]),
        Number(marker[1]),
      );
    }

    const copy: Data = {};

    for (const [key, entry] of Object.entries(value)) {
      copy[key] = decode(entry);
    }

    return copy;
  }

  return value;
}

/* =========================================================
   Paths and identifiers
   ========================================================= */

function splitPath(
  segments: string[],
): string[] {
  const parts = segments
    .flatMap((segment) =>
      String(segment).split("/"),
    )
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    throw new Error(
      "A document or collection path must not be empty.",
    );
  }

  return parts;
}

const ID_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function autoId(): string {
  const bytes = new Uint8Array(20);
  globalThis.crypto.getRandomValues(bytes);

  let id = "";

  for (const byte of bytes) {
    id += ID_ALPHABET[byte % ID_ALPHABET.length];
  }

  return id;
}

function parentPathOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

function idOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/* =========================================================
   References
   ========================================================= */

export class LocalDocumentReference {
  readonly [LOCAL_MARKER] = true;
  readonly type = "document";
  readonly converter = null;

  constructor(
    readonly firestore: LocalFirestore,
    readonly path: string,
  ) {}

  get id(): string {
    return idOf(this.path);
  }

  get parent(): LocalCollectionReference {
    return new LocalCollectionReference(
      this.firestore,
      parentPathOf(this.path),
    );
  }

  withConverter(): this {
    return this;
  }
}

export class LocalCollectionReference {
  readonly [LOCAL_MARKER] = true;
  readonly type = "collection";
  readonly converter = null;
  readonly specs: QuerySpec[] = [];

  constructor(
    readonly firestore: LocalFirestore,
    readonly path: string,
  ) {}

  get id(): string {
    return idOf(this.path);
  }

  get parent(): LocalDocumentReference | null {
    return this.path.includes("/")
      ? new LocalDocumentReference(
          this.firestore,
          parentPathOf(this.path),
        )
      : null;
  }

  withConverter(): this {
    return this;
  }
}

export type QuerySpec =
  | {
      kind: "where";
      field: string;
      op: string;
      value: unknown;
    }
  | {
      kind: "orderBy";
      field: string;
      direction: "asc" | "desc";
    }
  | {
      kind: "limit" | "limitToLast";
      count: number;
    }
  | {
      kind:
        | "startAt"
        | "startAfter"
        | "endAt"
        | "endBefore";
      values: unknown[];
    };

export type LocalConstraint = {
  [LOCAL_MARKER]: true;
  spec: QuerySpec;
};

export function localConstraint(
  spec: QuerySpec,
): LocalConstraint {
  return { [LOCAL_MARKER]: true, spec };
}

export class LocalQuery {
  readonly [LOCAL_MARKER] = true;
  readonly type = "query";
  readonly converter = null;

  constructor(
    readonly firestore: LocalFirestore,
    readonly path: string,
    readonly specs: QuerySpec[],
  ) {}

  withConverter(): this {
    return this;
  }
}

/* =========================================================
   Snapshots
   ========================================================= */

const SNAPSHOT_METADATA = Object.freeze({
  hasPendingWrites: false,
  fromCache: false,
  isEqual: () => true,
});

export class LocalDocumentSnapshot {
  readonly [LOCAL_MARKER] = true;
  readonly metadata = SNAPSHOT_METADATA;

  constructor(
    readonly ref: LocalDocumentReference,
    private readonly stored: Data | undefined,
  ) {}

  get id(): string {
    return this.ref.id;
  }

  exists(): boolean {
    return this.stored !== undefined;
  }

  data(): Data | undefined {
    return this.stored === undefined
      ? undefined
      : cloneValue(this.stored);
  }

  get(fieldPath: string): unknown {
    return cloneValue(
      getField(this.stored, fieldPath),
    );
  }

  /* Used by cursors, without a defensive copy. */
  rawField(fieldPath: string): unknown {
    return getField(this.stored, fieldPath);
  }
}

export class LocalQuerySnapshot {
  readonly [LOCAL_MARKER] = true;
  readonly metadata = SNAPSHOT_METADATA;

  constructor(
    readonly query: LocalQuery | LocalCollectionReference,
    readonly docs: LocalDocumentSnapshot[],
  ) {}

  get size(): number {
    return this.docs.length;
  }

  get empty(): boolean {
    return this.docs.length === 0;
  }

  forEach(
    callback: (
      snapshot: LocalDocumentSnapshot,
    ) => void,
  ): void {
    this.docs.forEach(callback);
  }

  docChanges(): never[] {
    return [];
  }
}

/* =========================================================
   Writes
   ========================================================= */

type PendingWrite =
  | {
      kind: "set";
      path: string;
      data: Data;
      merge: boolean;
    }
  | {
      kind: "update";
      path: string;
      data: Data;
    }
  | {
      kind: "delete";
      path: string;
    };

function setNested(
  target: Data,
  fieldPath: string,
  value: unknown,
  commitTime: Timestamp,
): void {
  const parts = fieldPath.split(".");
  let current = target;

  for (const part of parts.slice(0, -1)) {
    const next = current[part];

    if (!isPlainObject(next)) {
      current[part] = {};
    }

    current = current[part] as Data;
  }

  const last = parts[parts.length - 1];

  if (sentinelOf(value) === "deleteField") {
    delete current[last];
    return;
  }

  current[last] = normaliseValue(
    value,
    commitTime,
    fieldPath,
  );
}

function mergeInto(
  target: Data,
  source: Data,
  commitTime: Timestamp,
  prefix: string,
): void {
  for (const [key, value] of Object.entries(source)) {
    const fieldPath = prefix
      ? `${prefix}.${key}`
      : key;

    if (sentinelOf(value) === "deleteField") {
      delete target[key];
      continue;
    }

    if (
      isPlainObject(value) &&
      sentinelOf(value) === null &&
      isPlainObject(target[key])
    ) {
      mergeInto(
        target[key] as Data,
        value,
        commitTime,
        fieldPath,
      );
      continue;
    }

    target[key] = normaliseValue(
      value,
      commitTime,
      fieldPath,
    );
  }
}

function assertWritable(data: unknown): Data {
  if (!isPlainObject(data)) {
    throw new Error(
      "Data must be an object.",
    );
  }

  return data;
}

class WriteBuffer {
  readonly writes: PendingWrite[] = [];

  constructor(
    protected readonly db: LocalFirestore,
  ) {}

  set(
    ref: LocalDocumentReference,
    data: unknown,
    options?: { merge?: boolean },
  ): this {
    this.writes.push({
      kind: "set",
      path: ref.path,
      data: assertWritable(data),
      merge: Boolean(options?.merge),
    });

    return this;
  }

  update(
    ref: LocalDocumentReference,
    dataOrField: unknown,
    ...rest: unknown[]
  ): this {
    let data: Data;

    if (typeof dataOrField === "string") {
      data = { [dataOrField]: rest[0] };

      for (
        let index = 1;
        index < rest.length;
        index += 2
      ) {
        data[String(rest[index])] =
          rest[index + 1];
      }
    } else {
      data = assertWritable(dataOrField);
    }

    this.writes.push({
      kind: "update",
      path: ref.path,
      data,
    });

    return this;
  }

  delete(ref: LocalDocumentReference): this {
    this.writes.push({
      kind: "delete",
      path: ref.path,
    });

    return this;
  }
}

export class LocalWriteBatch extends WriteBuffer {
  async commit(): Promise<void> {
    await this.db.ready;
    this.db.applyWrites(this.writes);
  }
}

export class LocalTransaction extends WriteBuffer {
  readonly reads = new Map<string, number>();

  async get(
    ref: LocalDocumentReference,
  ): Promise<LocalDocumentSnapshot> {
    const stored = this.db.readStored(ref.path);

    if (!this.reads.has(ref.path)) {
      this.reads.set(
        ref.path,
        stored?.version ?? 0,
      );
    }

    return new LocalDocumentSnapshot(
      ref,
      stored?.data,
    );
  }
}

/* =========================================================
   The store
   ========================================================= */

type ChangeListener = () => void;

export class LocalFirestore {
  readonly [LOCAL_MARKER] = true;
  readonly type = "firestore";
  readonly app = null;

  readonly ready: Promise<void>;

  private readonly collections =
    new Map<string, Map<string, StoredDocument>>();

  private readonly listeners =
    new Set<ChangeListener>();

  private nextVersion = 1;

  private paused = 0;

  private pendingNotify = false;

  private saveTimer:
    | ReturnType<typeof setTimeout>
    | undefined;

  constructor(
    private readonly persistence: LocalPersistence | null = null,
  ) {
    this.ready = this.restore();
  }

  private async restore(): Promise<void> {
    if (!this.persistence) {
      return;
    }

    try {
      const serialized =
        await this.persistence.load();

      if (serialized) {
        this.importSerialized(serialized);
      }
    } catch (error) {
      console.error(
        "The demo data could not be restored; starting empty.",
        error,
      );
    }
  }

  /* ---------- reads ---------- */

  readStored(
    path: string,
  ): StoredDocument | undefined {
    return this.collections
      .get(parentPathOf(path))
      ?.get(idOf(path));
  }

  documentsIn(
    collectionPath: string,
  ): Array<[string, StoredDocument]> {
    return [
      ...(this.collections
        .get(collectionPath)
        ?.entries() ?? []),
    ];
  }

  collectionPaths(): string[] {
    return [...this.collections.keys()];
  }

  /* ---------- writes ---------- */

  applyWrites(writes: PendingWrite[]): void {
    if (writes.length === 0) {
      return;
    }

    const commitTime = Timestamp.now();

    /*
     * Every write is resolved against a staging copy first,
     * so a failure part-way leaves the store untouched, as a
     * failed commit leaves Firestore.
     */
    const staged = new Map<
      string,
      Data | null
    >();

    const current = (path: string) =>
      staged.has(path)
        ? staged.get(path) ?? undefined
        : this.readStored(path)?.data;

    for (const write of writes) {
      if (write.kind === "delete") {
        staged.set(write.path, null);
        continue;
      }

      if (write.kind === "update") {
        const existing = current(write.path);

        if (!existing) {
          throw new Error(
            `No document to update: ${write.path}`,
          );
        }

        const next = cloneValue(existing);

        for (const [fieldPath, value] of Object.entries(
          write.data,
        )) {
          setNested(
            next,
            fieldPath,
            value,
            commitTime,
          );
        }

        staged.set(write.path, next);
        continue;
      }

      if (write.merge) {
        const next = cloneValue(
          current(write.path) ?? {},
        );

        mergeInto(
          next,
          write.data,
          commitTime,
          "",
        );

        staged.set(write.path, next);
        continue;
      }

      staged.set(
        write.path,
        normaliseValue(
          write.data,
          commitTime,
          "",
        ) as Data,
      );
    }

    for (const [path, data] of staged) {
      const collectionPath = parentPathOf(path);
      const id = idOf(path);

      if (data === null) {
        this.collections
          .get(collectionPath)
          ?.delete(id);
        continue;
      }

      let documents =
        this.collections.get(collectionPath);

      if (!documents) {
        documents = new Map();
        this.collections.set(
          collectionPath,
          documents,
        );
      }

      documents.set(id, {
        data,
        version: this.nextVersion++,
      });
    }

    this.changed();
  }

  /* ---------- change propagation ---------- */

  subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  /*
   * Bulk work — loading sample data — would otherwise wake
   * every listener on the page hundreds of times.
   */
  async withNotificationsPaused<T>(
    work: () => Promise<T>,
  ): Promise<T> {
    this.paused += 1;

    try {
      return await work();
    } finally {
      this.paused -= 1;
      this.changed();
    }
  }

  private changed(): void {
    this.scheduleSave();

    if (this.paused > 0 || this.pendingNotify) {
      return;
    }

    this.pendingNotify = true;

    queueMicrotask(() => {
      this.pendingNotify = false;

      for (const listener of [...this.listeners]) {
        listener();
      }
    });
  }

  /* ---------- persistence ---------- */

  private scheduleSave(): void {
    if (!this.persistence) {
      return;
    }

    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.flush();
    }, 250);
  }

  async flush(): Promise<void> {
    if (!this.persistence) {
      return;
    }

    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }

    try {
      await this.persistence.save(
        this.exportSerialized(),
      );
    } catch (error) {
      console.error(
        "The demo data could not be saved in this browser.",
        error,
      );
    }
  }

  exportSerialized(): string {
    const documents: Record<string, unknown> = {};

    for (const [collectionPath, entries] of this
      .collections) {
      for (const [id, stored] of entries) {
        documents[`${collectionPath}/${id}`] =
          encode(stored.data);
      }
    }

    return JSON.stringify({
      format: "fleetdesk-demo",
      version: 1,
      documents,
    });
  }

  importSerialized(serialized: string): void {
    const parsed = JSON.parse(serialized) as {
      format?: string;
      documents?: Record<string, unknown>;
    };

    if (
      parsed.format !== "fleetdesk-demo" ||
      !parsed.documents
    ) {
      throw new Error(
        "This file is not a FleetDesk demo export.",
      );
    }

    this.collections.clear();

    for (const [path, data] of Object.entries(
      parsed.documents,
    )) {
      const collectionPath = parentPathOf(path);

      let documents =
        this.collections.get(collectionPath);

      if (!documents) {
        documents = new Map();
        this.collections.set(
          collectionPath,
          documents,
        );
      }

      documents.set(idOf(path), {
        data: decode(data) as Data,
        version: this.nextVersion++,
      });
    }

    this.changed();
  }

  async reset(): Promise<void> {
    await this.ready;
    this.collections.clear();
    this.changed();
    await this.flush();
  }
}

/* =========================================================
   Query execution
   ========================================================= */

function matchesFilter(
  data: Data,
  spec: Extract<QuerySpec, { kind: "where" }>,
): boolean {
  const value = getField(data, spec.field);

  if (value === undefined) {
    return false;
  }

  switch (spec.op) {
    case "==":
      return valuesEqual(value, spec.value);
    case "!=":
      return (
        value !== null &&
        !valuesEqual(value, spec.value)
      );
    case "<":
    case "<=":
    case ">":
    case ">=": {
      if (typeRank(value) !== typeRank(spec.value)) {
        return false;
      }

      const result = compareValues(
        value,
        spec.value,
      );

      return spec.op === "<"
        ? result < 0
        : spec.op === "<="
          ? result <= 0
          : spec.op === ">"
            ? result > 0
            : result >= 0;
    }
    case "in":
      return (spec.value as unknown[]).some(
        (candidate) =>
          valuesEqual(value, candidate),
      );
    case "not-in":
      return (
        value !== null &&
        !(spec.value as unknown[]).some(
          (candidate) =>
            valuesEqual(value, candidate),
        )
      );
    case "array-contains":
      return (
        Array.isArray(value) &&
        value.some((entry) =>
          valuesEqual(entry, spec.value),
        )
      );
    case "array-contains-any":
      return (
        Array.isArray(value) &&
        value.some((entry) =>
          (spec.value as unknown[]).some(
            (candidate) =>
              valuesEqual(entry, candidate),
          ),
        )
      );
    default:
      throw new Error(
        `Unsupported query operator: ${spec.op}`,
      );
  }
}

const INEQUALITY = new Set([
  "<",
  "<=",
  ">",
  ">=",
  "!=",
  "not-in",
]);

type Row = {
  id: string;
  path: string;
  data: Data;
  version: number;
};

function cursorValues(
  values: unknown[],
  orderFields: string[],
): unknown[] {
  const [first] = values;

  if (
    values.length === 1 &&
    first instanceof LocalDocumentSnapshot
  ) {
    return [
      ...orderFields.map((field) =>
        field === "__name__"
          ? first.ref.path
          : first.rawField(field),
      ),
    ];
  }

  return values;
}

export function executeQuery(
  db: LocalFirestore,
  collectionPath: string,
  specs: QuerySpec[],
): Row[] {
  let rows: Row[] = db
    .documentsIn(collectionPath)
    .map(([id, stored]) => ({
      id,
      path: `${collectionPath}/${id}`,
      data: stored.data,
      version: stored.version,
    }));

  const filters = specs.filter(
    (spec): spec is Extract<QuerySpec, { kind: "where" }> =>
      spec.kind === "where",
  );

  for (const filter of filters) {
    rows = rows.filter((row) =>
      matchesFilter(row.data, filter),
    );
  }

  const orderings: Array<{
    field: string;
    direction: "asc" | "desc";
  }> = specs
    .filter(
      (spec): spec is Extract<QuerySpec, { kind: "orderBy" }> =>
        spec.kind === "orderBy",
    )
    .map((spec) => ({
      field: spec.field,
      direction: spec.direction,
    }));

  const inequality = filters.find((filter) =>
    INEQUALITY.has(filter.op),
  );

  if (
    inequality &&
    !orderings.some(
      (ordering) =>
        ordering.field === inequality.field,
    )
  ) {
    orderings.unshift({
      field: inequality.field,
      direction: "asc",
    });
  }

  for (const ordering of orderings) {
    rows = rows.filter(
      (row) =>
        getField(row.data, ordering.field) !==
        undefined,
    );
  }

  const tieDirection =
    orderings[orderings.length - 1]?.direction ??
    "asc";

  const fullOrder = [
    ...orderings,
    {
      field: "__name__",
      direction: tieDirection,
    },
  ];

  const valueOf = (row: Row, field: string) =>
    field === "__name__"
      ? row.path
      : getField(row.data, field);

  const compareRows = (left: Row, right: Row) => {
    for (const ordering of fullOrder) {
      const result = compareValues(
        valueOf(left, ordering.field),
        valueOf(right, ordering.field),
      );

      if (result !== 0) {
        return ordering.direction === "desc"
          ? -result
          : result;
      }
    }

    return 0;
  };

  rows.sort(compareRows);

  const orderFields = fullOrder.map(
    (ordering) => ordering.field,
  );

  const compareToCursor = (
    row: Row,
    values: unknown[],
  ) => {
    for (
      let index = 0;
      index < values.length &&
      index < fullOrder.length;
      index += 1
    ) {
      const ordering = fullOrder[index];
      const result = compareValues(
        valueOf(row, ordering.field),
        values[index],
      );

      if (result !== 0) {
        return ordering.direction === "desc"
          ? -result
          : result;
      }
    }

    return 0;
  };

  for (const spec of specs) {
    if (
      spec.kind !== "startAt" &&
      spec.kind !== "startAfter" &&
      spec.kind !== "endAt" &&
      spec.kind !== "endBefore"
    ) {
      continue;
    }

    const values = cursorValues(
      spec.values,
      orderFields,
    );

    rows = rows.filter((row) => {
      const result = compareToCursor(row, values);

      switch (spec.kind) {
        case "startAt":
          return result >= 0;
        case "startAfter":
          return result > 0;
        case "endAt":
          return result <= 0;
        case "endBefore":
          return result < 0;
      }
    });
  }

  for (const spec of specs) {
    if (spec.kind === "limit") {
      rows = rows.slice(0, spec.count);
    }

    if (spec.kind === "limitToLast") {
      rows = rows.slice(
        Math.max(0, rows.length - spec.count),
      );
    }
  }

  return rows;
}

/* =========================================================
   Function API (mirrors firebase/firestore)
   ========================================================= */

export function localCollection(
  parent: LocalFirestore | LocalDocumentReference,
  ...segments: string[]
): LocalCollectionReference {
  const db =
    parent instanceof LocalFirestore
      ? parent
      : parent.firestore;

  const parts = splitPath(
    parent instanceof LocalFirestore
      ? segments
      : [parent.path, ...segments],
  );

  if (parts.length % 2 !== 1) {
    throw new Error(
      `Invalid collection reference: ${parts.join("/")} has an even number of segments.`,
    );
  }

  return new LocalCollectionReference(
    db,
    parts.join("/"),
  );
}

export function localDoc(
  parent: LocalFirestore | LocalCollectionReference,
  ...segments: string[]
): LocalDocumentReference {
  if (
    parent instanceof LocalCollectionReference &&
    segments.length === 0
  ) {
    return new LocalDocumentReference(
      parent.firestore,
      `${parent.path}/${autoId()}`,
    );
  }

  const db =
    parent instanceof LocalFirestore
      ? parent
      : parent.firestore;

  const parts = splitPath(
    parent instanceof LocalFirestore
      ? segments
      : [parent.path, ...segments],
  );

  if (parts.length % 2 !== 0) {
    throw new Error(
      `Invalid document reference: ${parts.join("/")} has an odd number of segments.`,
    );
  }

  return new LocalDocumentReference(
    db,
    parts.join("/"),
  );
}

export function localQuery(
  base: LocalCollectionReference | LocalQuery,
  ...constraints: Array<LocalConstraint | null | undefined>
): LocalQuery {
  const specs = constraints
    .filter(
      (constraint): constraint is LocalConstraint =>
        Boolean(constraint),
    )
    .map((constraint) => {
      if (!isLocalObject(constraint)) {
        throw new Error(
          "A Firebase query constraint was used with the demo store.",
        );
      }

      return constraint.spec;
    });

  return new LocalQuery(
    base.firestore,
    base.path,
    [...base.specs, ...specs],
  );
}

export async function localGetDoc(
  ref: LocalDocumentReference,
): Promise<LocalDocumentSnapshot> {
  await ref.firestore.ready;

  return new LocalDocumentSnapshot(
    ref,
    ref.firestore.readStored(ref.path)?.data,
  );
}

function snapshotQuery(
  target: LocalQuery | LocalCollectionReference,
): LocalQuerySnapshot {
  const rows = executeQuery(
    target.firestore,
    target.path,
    target.specs,
  );

  return new LocalQuerySnapshot(
    target,
    rows.map(
      (row) =>
        new LocalDocumentSnapshot(
          new LocalDocumentReference(
            target.firestore,
            row.path,
          ),
          row.data,
        ),
    ),
  );
}

export async function localGetDocs(
  target: LocalQuery | LocalCollectionReference,
): Promise<LocalQuerySnapshot> {
  await target.firestore.ready;

  return snapshotQuery(target);
}

export async function localRunTransaction<T>(
  db: LocalFirestore,
  work: (transaction: LocalTransaction) => Promise<T>,
  options?: { maxAttempts?: number },
): Promise<T> {
  await db.ready;

  const attempts = options?.maxAttempts ?? 5;

  for (let attempt = 1; ; attempt += 1) {
    const transaction = new LocalTransaction(db);
    const result = await work(transaction);

    const conflicted = [
      ...transaction.reads,
    ].some(
      ([path, version]) =>
        (db.readStored(path)?.version ?? 0) !==
        version,
    );

    if (!conflicted) {
      db.applyWrites(transaction.writes);
      return result;
    }

    if (attempt >= attempts) {
      throw new Error(
        "Transaction failed: the data changed while it was being saved. Please try again.",
      );
    }
  }
}

export function localWriteBatch(
  db: LocalFirestore,
): LocalWriteBatch {
  return new LocalWriteBatch(db);
}

type SnapshotObserver<T> = {
  next?: (snapshot: T) => void;
  error?: (error: Error) => void;
};

export function localOnSnapshot(
  target:
    | LocalDocumentReference
    | LocalQuery
    | LocalCollectionReference,
  ...args: unknown[]
): () => void {
  const callbacks = args.filter(
    (arg) =>
      typeof arg === "function" ||
      (arg !== null &&
        typeof arg === "object" &&
        ("next" in arg || "error" in arg)),
  );

  let next: ((snapshot: never) => void) | undefined;
  let error: ((error: Error) => void) | undefined;

  if (
    callbacks[0] &&
    typeof callbacks[0] === "object"
  ) {
    const observer =
      callbacks[0] as SnapshotObserver<never>;
    next = observer.next;
    error = observer.error;
  } else {
    next = callbacks[0] as typeof next;
    error = callbacks[1] as typeof error;
  }

  const db = target.firestore;
  let cancelled = false;
  let lastSignature: string | null = null;

  const deliver = () => {
    if (cancelled) {
      return;
    }

    try {
      let snapshot:
        | LocalDocumentSnapshot
        | LocalQuerySnapshot;
      let signature: string;

      if (target instanceof LocalDocumentReference) {
        const stored = db.readStored(target.path);
        signature = String(stored?.version ?? 0);
        snapshot = new LocalDocumentSnapshot(
          target,
          stored?.data,
        );
      } else {
        const rows = executeQuery(
          db,
          target.path,
          target.specs,
        );
        signature = rows
          .map((row) => `${row.path}@${row.version}`)
          .join("|");
        snapshot = new LocalQuerySnapshot(
          target,
          rows.map(
            (row) =>
              new LocalDocumentSnapshot(
                new LocalDocumentReference(
                  db,
                  row.path,
                ),
                row.data,
              ),
          ),
        );
      }

      if (signature === lastSignature) {
        return;
      }

      lastSignature = signature;
      next?.(snapshot as never);
    } catch (cause) {
      error?.(
        cause instanceof Error
          ? cause
          : new Error(String(cause)),
      );
    }
  };

  const unsubscribe = db.subscribe(deliver);

  void db.ready.then(() => {
    setTimeout(deliver, 0);
  });

  return () => {
    cancelled = true;
    unsubscribe();
  };
}
