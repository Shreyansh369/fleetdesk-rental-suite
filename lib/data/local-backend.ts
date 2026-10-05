import {
  DEMO_PASSWORD,
  SAMPLE_STAFF,
} from "@/lib/demo/sample-data";

import {
  LOCAL_MARKER,
  LocalFirestore,
  localDoc,
  localServerTimestamp,
  localWriteBatch,
  type LocalPersistence,
} from "./local-firestore";

/*
 * The demo workspace: a local store, and sign-in against the
 * demo accounts kept in it. Every demo account shares one
 * published password (DEMO_PASSWORD); nothing here is a secret
 * or protects anything, it only lets a visitor sign in as the
 * owner, a manager or a desk employee and see the workspace the
 * way each of them would. That is how the employee side of the
 * workflows — a discount waiting for approval, a contract
 * submitted for review — can be tried by one person.
 */

export const DEMO_OWNER_UID = "demo-admin";

export function demoUid(key: string): string {
  return `demo-${key}`;
}

const DATABASE_NAME = "fleetdesk-demo";
const STORE_NAME = "state";
const RECORD_KEY = "workspace";
const SIGNED_IN_KEY = "fleetdesk.demo.uid";

/* =========================================================
   IndexedDB persistence
   ========================================================= */

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const database = await openDatabase();

  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(
        STORE_NAME,
        mode,
      );
      const request = action(
        transaction.objectStore(STORE_NAME),
      );

      request.onsuccess = () =>
        resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

/*
 * IndexedDB rather than localStorage: condition photographs and
 * licence images are kept as compressed data URLs in the demo,
 * which outgrow localStorage's few megabytes within a few hires.
 */
export const indexedDbPersistence: LocalPersistence = {
  async load() {
    return (
      (await withStore<string | undefined>(
        "readonly",
        (store) => store.get(RECORD_KEY),
      )) ?? null
    );
  },

  async save(serialized) {
    await withStore("readwrite", (store) =>
      store.put(serialized, RECORD_KEY),
    );
  },

  async clear() {
    await withStore("readwrite", (store) =>
      store.delete(RECORD_KEY),
    );
  },
};

/* =========================================================
   Auth stand-in
   ========================================================= */

export class LocalUser {
  readonly [LOCAL_MARKER] = true;
  readonly emailVerified = true;
  readonly isAnonymous = false;
  readonly providerData = [];
  readonly providerId = "demo";

  constructor(
    readonly uid: string,
    readonly email: string | null,
    readonly displayName: string | null,
  ) {}

  async getIdToken(): Promise<string> {
    return `demo-token-${this.uid}`;
  }

  async reload(): Promise<void> {}

  async delete(): Promise<void> {}

  toJSON() {
    return {
      uid: this.uid,
      email: this.email,
      displayName: this.displayName,
    };
  }
}

type AuthListener = (user: LocalUser | null) => void;

function rememberSignedIn(uid: string | null): void {
  try {
    if (uid) {
      window.localStorage.setItem(SIGNED_IN_KEY, uid);
    } else {
      window.localStorage.removeItem(SIGNED_IN_KEY);
    }
  } catch {
    // The default profile is used when nothing is remembered.
  }
}

function rememberedSignedIn(): string | null {
  try {
    return window.localStorage.getItem(SIGNED_IN_KEY);
  } catch {
    return null;
  }
}

export class LocalAuth {
  readonly [LOCAL_MARKER] = true;
  readonly type = "local-auth";

  currentUser: LocalUser | null = null;

  readonly ready: Promise<void>;

  private readonly listeners =
    new Set<AuthListener>();

  constructor(private readonly db: LocalFirestore) {
    this.ready = this.restore();
  }

  private async restore(): Promise<void> {
    await this.db.ready;
    await ensureDemoAccounts(this.db);

    const remembered = rememberedSignedIn();
    const profile = remembered
      ? this.db.readStored(`users/${remembered}`)
      : undefined;

    this.currentUser =
      remembered && profile
        ? userFromProfile(remembered, profile.data)
        : null;
  }

  /*
   * Signs in with a demo account's email and the demo password.
   * Any account in the store can sign in — including one a
   * visitor added from Demo tools — and lands where its approval
   * and role allow, exactly as a live sign-in does.
   */
  async signInWithPassword(
    email: string,
    password: string,
  ): Promise<void> {
    await this.ready;

    const wanted = email.trim().toLowerCase();

    const match = this.db
      .documentsIn("users")
      .find(
        ([, stored]) =>
          String(stored.data.email ?? "")
            .trim()
            .toLowerCase() === wanted,
      );

    if (!match || password !== DEMO_PASSWORD) {
      throw new Error(
        "That email and password do not match a demo account. The demo accounts are listed on this page.",
      );
    }

    await this.signInAs(match[0]);
  }

  onAuthStateChanged(
    listener: AuthListener,
  ): () => void {
    this.listeners.add(listener);

    void this.ready.then(() => {
      if (this.listeners.has(listener)) {
        listener(this.currentUser);
      }
    });

    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      listener(this.currentUser);
    }
  }

  async signInAs(uid: string): Promise<void> {
    await this.ready;

    const profile = this.db.readStored(
      `users/${uid}`,
    );

    if (!profile) {
      throw new Error(
        "That staff profile no longer exists in the demo.",
      );
    }

    this.currentUser = userFromProfile(
      uid,
      profile.data,
    );
    rememberSignedIn(uid);
    this.notify();
  }

  async signOut(): Promise<void> {
    this.currentUser = null;
    rememberSignedIn(null);
    this.notify();
  }

  /*
   * Acts as another profile without telling the page, so bulk
   * work attributed to several staff members does not flip the
   * whole screen between them. Returns the undo.
   */
  impersonate(
    uid: string,
    email: string | null,
    displayName: string | null,
  ): () => void {
    const previous = this.currentUser;

    this.currentUser = new LocalUser(
      uid,
      email,
      displayName,
    );

    return () => {
      this.currentUser = previous;
    };
  }

  async restart(): Promise<void> {
    await ensureDemoAccounts(this.db);
    await this.signOut();
  }
}

function userFromProfile(
  uid: string,
  profile: Record<string, unknown> | undefined,
): LocalUser {
  return new LocalUser(
    uid,
    typeof profile?.email === "string"
      ? profile.email
      : null,
    typeof profile?.fullName === "string"
      ? profile.fullName
      : null,
  );
}

/*
 * The demo accounts exist in every demo, empty or not, so the
 * published sign-ins always work and the workspace always has
 * administrators to approve staff and see the finances. Business
 * data — vehicles, customers, bookings — starts empty, for the
 * visitor's own numbers, until they load the sample business.
 */
export async function ensureDemoAccounts(
  db: LocalFirestore,
): Promise<Record<string, string>> {
  await db.ready;

  const uids: Record<string, string> = {};
  const batch = localWriteBatch(db);
  let missing = 0;

  for (const member of SAMPLE_STAFF) {
    const uid = demoUid(member.key);
    uids[member.key] = uid;

    if (db.readStored(`users/${uid}`)) {
      continue;
    }

    missing += 1;

    batch.set(localDoc(db, "users", uid), {
      fullName: member.fullName,
      email: member.email,
      jobTitle: member.title,
      mobile: member.mobile,
      age: member.age,
      requestedRole: member.role,
      emailVerified: true,
      ...(member.status === "approved"
        ? {
            role: member.role,
            status: "approved",
            decidedAt: localServerTimestamp(),
            decidedByNameSnapshot: "Alex Morgan",
          }
        : { role: null, status: "pending" }),
      createdAt: localServerTimestamp(),
      updatedAt: localServerTimestamp(),
    });
  }

  if (missing > 0) {
    await batch.commit();
  }

  return uids;
}

/* =========================================================
   Singleton
   ========================================================= */

export type LocalBackend = {
  db: LocalFirestore;
  auth: LocalAuth;
};

let backend: LocalBackend | undefined;

export function getLocalBackend(): LocalBackend {
  if (!backend) {
    const db = new LocalFirestore(
      typeof indexedDB === "undefined"
        ? null
        : indexedDbPersistence,
    );

    backend = {
      db,
      auth: new LocalAuth(db),
    };

    if (typeof window !== "undefined") {
      /* A tab closed inside the save debounce keeps its data. */
      window.addEventListener("pagehide", () => {
        void db.flush();
      });
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
          void db.flush();
        }
      });
    }
  }

  return backend;
}
