import { FieldValue, type Transaction } from "firebase-admin/firestore";
import { db } from "./firebase";

export function audit(transaction: Transaction, actorUid: string, action: string, target: { collection: string; id: string }, metadata: Record<string, unknown> = {}): void {
  transaction.create(db.collection("auditLogs").doc(), { actorUid, action, target, metadata, occurredAt: FieldValue.serverTimestamp() });
}
