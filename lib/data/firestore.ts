import * as firebase from "firebase/firestore";

import { isDemoMode } from "./mode";
import {
  LocalCollectionReference,
  LocalDocumentReference,
  LocalFirestore,
  LocalQuery,
  isLocalObject,
  localCollection,
  localConstraint,
  localDeleteField,
  localDoc,
  localGetDoc,
  localGetDocs,
  localOnSnapshot,
  localQuery,
  localRunTransaction,
  localServerTimestamp,
  localWriteBatch,
} from "./local-firestore";

/*
 * The one place the workspace imports Firestore from.
 *
 * Every function here has the exact signature of its
 * firebase/firestore namesake and routes to one of two
 * backends:
 *
 * - the demo store on this device (lib/data/local-firestore.ts),
 *   when the visitor is trying FleetDesk without an account;
 * - Firebase, with every operational collection placed under
 *   workspaces/{workspaceId}/…, so trials and paid licences
 *   share one project without ever seeing each other's data.
 *
 * The workflow code is written once against plain collection
 * names ("vehicles", "rentals", …) and runs unchanged on both.
 */

export type * from "firebase/firestore";
export { Timestamp } from "firebase/firestore";

/* =========================================================
   Workspace scoping (live backend)
   ========================================================= */

/*
 * Collections that live at the root of the project, outside
 * any one workspace: the workspace records themselves, the
 * account → workspace index, and the one-trial-per-email claims.
 */
export const GLOBAL_COLLECTIONS: ReadonlySet<string> =
  new Set(["workspaces", "accounts", "trialEmails"]);

let activeWorkspaceId: string | null = null;

export function setWorkspaceScope(
  workspaceId: string | null,
): void {
  activeWorkspaceId = workspaceId;
}

export function workspaceScope(): string | null {
  return activeWorkspaceId;
}

export function scopedSegments(
  segments: string[],
  workspaceId: string | null = activeWorkspaceId,
): [string, ...string[]] {
  const parts = segments
    .flatMap((segment) => String(segment).split("/"))
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    throw new Error(
      "A document or collection path must not be empty.",
    );
  }

  if (GLOBAL_COLLECTIONS.has(parts[0])) {
    return parts as [string, ...string[]];
  }

  if (!workspaceId) {
    throw new Error(
      "No workspace is open. Please sign in again.",
    );
  }

  return ["workspaces", workspaceId, ...parts];
}

/* =========================================================
   References
   ========================================================= */

export const collection = ((
  parent: unknown,
  ...segments: string[]
) => {
  if (isLocalObject(parent)) {
    return localCollection(
      parent as LocalFirestore | LocalDocumentReference,
      ...segments,
    );
  }

  if (parent instanceof firebase.Firestore) {
    const [first, ...rest] = scopedSegments(segments);

    return firebase.collection(parent, first, ...rest);
  }

  return firebase.collection(
    parent as any,
    segments[0],
    ...segments.slice(1),
  );
}) as typeof firebase.collection;

export const doc = ((
  parent: unknown,
  ...segments: string[]
) => {
  if (isLocalObject(parent)) {
    return localDoc(
      parent as LocalFirestore | LocalCollectionReference,
      ...segments,
    );
  }

  if (parent instanceof firebase.Firestore) {
    const [first, ...rest] = scopedSegments(segments);

    return firebase.doc(parent, first, ...rest);
  }

  return segments.length === 0
    ? firebase.doc(parent as any)
    : firebase.doc(
        parent as any,
        segments[0],
        ...segments.slice(1),
      );
}) as typeof firebase.doc;

/* =========================================================
   Query constraints
   ========================================================= */

export const where = ((
  field: string,
  op: firebase.WhereFilterOp,
  value: unknown,
) =>
  isDemoMode()
    ? localConstraint({
        kind: "where",
        field: String(field),
        op,
        value,
      })
    : firebase.where(field, op, value)) as typeof firebase.where;

export const orderBy = ((
  field: string,
  direction: firebase.OrderByDirection = "asc",
) =>
  isDemoMode()
    ? localConstraint({
        kind: "orderBy",
        field: String(field),
        direction,
      })
    : firebase.orderBy(field, direction)) as typeof firebase.orderBy;

export const limit = ((count: number) =>
  isDemoMode()
    ? localConstraint({ kind: "limit", count })
    : firebase.limit(count)) as typeof firebase.limit;

export const limitToLast = ((count: number) =>
  isDemoMode()
    ? localConstraint({ kind: "limitToLast", count })
    : firebase.limitToLast(count)) as typeof firebase.limitToLast;

function cursor(
  kind: "startAt" | "startAfter" | "endAt" | "endBefore",
  firebaseCursor: (...values: unknown[]) => unknown,
) {
  return (...values: unknown[]) =>
    isDemoMode() || values.some(isLocalObject)
      ? localConstraint({ kind, values })
      : firebaseCursor(...values);
}

export const startAt = cursor(
  "startAt",
  firebase.startAt,
) as typeof firebase.startAt;

export const startAfter = cursor(
  "startAfter",
  firebase.startAfter,
) as typeof firebase.startAfter;

export const endAt = cursor(
  "endAt",
  firebase.endAt,
) as typeof firebase.endAt;

export const endBefore = cursor(
  "endBefore",
  firebase.endBefore,
) as typeof firebase.endBefore;

export const query = ((
  base: unknown,
  ...constraints: unknown[]
) =>
  isLocalObject(base)
    ? localQuery(
        base as LocalCollectionReference | LocalQuery,
        ...(constraints as any[]),
      )
    : firebase.query(
        base as any,
        ...(constraints as any[]),
      )) as typeof firebase.query;

/* =========================================================
   Field values
   ========================================================= */

export const serverTimestamp = (() =>
  isDemoMode()
    ? localServerTimestamp()
    : firebase.serverTimestamp()) as typeof firebase.serverTimestamp;

export const deleteField = (() =>
  isDemoMode()
    ? localDeleteField()
    : firebase.deleteField()) as typeof firebase.deleteField;

/* =========================================================
   Reads, writes and listeners
   ========================================================= */

export const getDoc = ((ref: unknown) =>
  isLocalObject(ref)
    ? localGetDoc(ref as LocalDocumentReference)
    : firebase.getDoc(ref as any)) as typeof firebase.getDoc;

export const getDocs = ((target: unknown) =>
  isLocalObject(target)
    ? localGetDocs(
        target as LocalQuery | LocalCollectionReference,
      )
    : firebase.getDocs(target as any)) as typeof firebase.getDocs;

export const runTransaction = ((
  db: unknown,
  work: (transaction: any) => Promise<unknown>,
  options?: firebase.TransactionOptions,
) =>
  isLocalObject(db)
    ? localRunTransaction(
        db as LocalFirestore,
        work,
        options,
      )
    : firebase.runTransaction(
        db as firebase.Firestore,
        work,
        options,
      )) as typeof firebase.runTransaction;

export const writeBatch = ((db: unknown) =>
  isLocalObject(db)
    ? localWriteBatch(db as LocalFirestore)
    : firebase.writeBatch(
        db as firebase.Firestore,
      )) as typeof firebase.writeBatch;

export const setDoc = (async (
  ref: unknown,
  data: unknown,
  options?: firebase.SetOptions,
) => {
  if (!isLocalObject(ref)) {
    return firebase.setDoc(
      ref as any,
      data as any,
      options ?? {},
    );
  }

  const target = ref as LocalDocumentReference;
  const batch = localWriteBatch(target.firestore);
  batch.set(target, data, options as { merge?: boolean });
  await batch.commit();
}) as typeof firebase.setDoc;

export const updateDoc = (async (
  ref: unknown,
  data: unknown,
  ...rest: unknown[]
) => {
  if (!isLocalObject(ref)) {
    return (firebase.updateDoc as any)(ref, data, ...rest);
  }

  const target = ref as LocalDocumentReference;
  const batch = localWriteBatch(target.firestore);
  batch.update(target, data, ...rest);
  await batch.commit();
}) as typeof firebase.updateDoc;

export const deleteDoc = (async (ref: unknown) => {
  if (!isLocalObject(ref)) {
    return firebase.deleteDoc(ref as any);
  }

  const target = ref as LocalDocumentReference;
  const batch = localWriteBatch(target.firestore);
  batch.delete(target);
  await batch.commit();
}) as typeof firebase.deleteDoc;

export const addDoc = (async (
  reference: unknown,
  data: unknown,
) => {
  if (!isLocalObject(reference)) {
    return firebase.addDoc(reference as any, data as any);
  }

  const target = localDoc(
    reference as LocalCollectionReference,
  );
  const batch = localWriteBatch(target.firestore);
  batch.set(target, data);
  await batch.commit();

  return target;
}) as typeof firebase.addDoc;

export const onSnapshot = ((
  target: unknown,
  ...args: unknown[]
) =>
  isLocalObject(target)
    ? localOnSnapshot(
        target as
          | LocalDocumentReference
          | LocalQuery
          | LocalCollectionReference,
        ...args,
      )
    : (firebase.onSnapshot as any)(
        target,
        ...args,
      )) as typeof firebase.onSnapshot;
