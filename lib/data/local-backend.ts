import {
  LOCAL_MARKER,
  LocalFirestore,
  localDoc,
  localServerTimestamp,
  localWriteBatch,
  type LocalPersistence,
} from "./local-firestore";

/*
 * The demo workspace: a local store, and a signed-in "user"
 * that is simply whichever staff profile in that store the
 * visitor is looking through. The visitor starts as the
 * administrator and can switch to any other profile from the
 * demo bar, which is how the employee side of the workflows —
 * a discount waiting for approval, a contract submitted for
 * review — can be tried by one person.
 */

export const DEMO_OWNER_UID = "demo-owner";

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
    await ensureDemoOwner(this.db);

    const remembered = rememberedSignedIn();

    const uid =
      remembered &&
      this.db.readStored(`users/${remembered}`)
        ? remembered
        : DEMO_OWNER_UID;

    this.currentUser = userFromProfile(
      uid,
      this.db.readStored(`users/${uid}`)?.data,
    );
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
    await ensureDemoOwner(this.db);
    rememberSignedIn(null);
    await this.signInAs(DEMO_OWNER_UID);
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
 * The visitor's own administrator profile. It exists in every
 * demo, empty or not, so the workspace always has somebody who
 * can approve staff and see the finances.
 */
export async function ensureDemoOwner(
  db: LocalFirestore,
): Promise<void> {
  await db.ready;

  if (db.readStored(`users/${DEMO_OWNER_UID}`)) {
    return;
  }

  const batch = localWriteBatch(db);

  batch.set(localDoc(db, "users", DEMO_OWNER_UID), {
    fullName: "Demo Administrator",
    email: "you@demo.fleetdesk.app",
    mobile: "+1 555 010 0000",
    age: 35,
    requestedRole: "admin",
    role: "admin",
    status: "approved",
    emailVerified: true,
    createdAt: localServerTimestamp(),
    updatedAt: localServerTimestamp(),
  });

  await batch.commit();
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
