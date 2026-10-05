import * as firebaseAuth from "firebase/auth";

import { isLocalObject } from "./local-firestore";
import type { LocalAuth } from "./local-backend";

/*
 * The two auth calls the workspace makes on every screen, routed
 * to the demo's profile switcher or to Firebase Authentication.
 * Sign-in and registration only exist in the live workspace and
 * keep importing firebase/auth directly.
 */

export type { User } from "firebase/auth";

export function onAuthStateChanged(
  auth: firebaseAuth.Auth,
  listener: (user: firebaseAuth.User | null) => void,
): () => void {
  if (isLocalObject(auth)) {
    return (auth as unknown as LocalAuth).onAuthStateChanged(
      listener as never,
    );
  }

  return firebaseAuth.onAuthStateChanged(auth, listener);
}

export function signOut(
  auth: firebaseAuth.Auth,
): Promise<void> {
  if (isLocalObject(auth)) {
    return (auth as unknown as LocalAuth).signOut();
  }

  return firebaseAuth.signOut(auth);
}
