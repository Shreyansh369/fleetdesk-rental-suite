"use client";

import {
  getApps,
  getApp,
  initializeApp,
  type FirebaseApp,
} from "firebase/app";

import {
  connectAuthEmulator,
  getAuth,
  type Auth,
} from "firebase/auth";

import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from "firebase/firestore";

import {
  connectStorageEmulator,
  getStorage,
  type FirebaseStorage,
} from "firebase/storage";

import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from "firebase/app-check";

import { firebaseEnvironment } from "./config";
import { isDemoMode } from "@/lib/data/mode";
import { getLocalBackend } from "@/lib/data/local-backend";

export interface FirebaseClient {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  storage: FirebaseStorage;
  appCheck?: AppCheck;
}

let client:
  | FirebaseClient
  | undefined;

let demoClient:
  | FirebaseClient
  | undefined;

/*
 * The demo workspace answers to the same shape, with the local
 * store standing in for Firestore and the profile switcher for
 * Authentication, so every caller of getFirebaseClient() — and
 * every workflow behind it — runs unchanged on this device. All
 * Firestore calls go through lib/data/firestore.ts, which tells
 * the two apart. There is no Storage in the demo; media are
 * kept as data URLs instead.
 */
function getDemoClient(): FirebaseClient {
  if (!demoClient) {
    const local = getLocalBackend();

    demoClient = {
      app: null as unknown as FirebaseApp,
      auth: local.auth as unknown as Auth,
      db: local.db as unknown as Firestore,
      storage: null as unknown as FirebaseStorage,
    };
  }

  return demoClient;
}

let emulatorsConnected = false;

let appCheckInitialized = false;

export function getFirebaseClient(): FirebaseClient {
  if (isDemoMode()) {
    return getDemoClient();
  }

  if (client) {
    return client;
  }

  const environment =
    firebaseEnvironment();

  if (!environment) {
    throw new Error(
      "Firebase is not configured. Set the required NEXT_PUBLIC_FIREBASE_* values.",
    );
  }

  const app =
    getApps().length
      ? getApp()
      : initializeApp(
          environment,
        );

  const auth =
    getAuth(app);

  const db =
    getFirestore(app);

  const storage =
    getStorage(app);

  let appCheck:
    | AppCheck
    | undefined;

  if (
    !environment.useEmulators &&
    environment.appCheckSiteKey &&
    typeof window !==
      "undefined" &&
    !appCheckInitialized
  ) {
    appCheck =
      initializeAppCheck(
        app,
        {
          provider:
            new ReCaptchaEnterpriseProvider(
              environment.appCheckSiteKey,
            ),

          isTokenAutoRefreshEnabled:
            true,
        },
      );

    appCheckInitialized =
      true;
  }

  if (
    environment.useEmulators &&
    typeof window !==
      "undefined" &&
    !emulatorsConnected
  ) {
    connectAuthEmulator(
      auth,
      "http://127.0.0.1:9099",
      {
        disableWarnings:
          true,
      },
    );

    connectFirestoreEmulator(
      db,
      "127.0.0.1",
      8080,
    );

    connectStorageEmulator(
      storage,
      "127.0.0.1",
      9199,
    );

    emulatorsConnected =
      true;
  }

  client = {
    app,
    auth,
    db,
    storage,
    ...(appCheck
      ? {
          appCheck,
        }
      : {}),
  };

  return client;
}