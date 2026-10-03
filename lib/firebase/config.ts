export interface FirebaseEnvironment {
  apiKey: string;
  authDomain: string;
  projectId: string;
  messagingSenderId: string;
  appId: string;
  appCheckSiteKey?: string;
  useEmulators: boolean;
}

export function firebaseEnvironment(): FirebaseEnvironment | null {
  const apiKey =
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();

  const authDomain =
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim();

  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();

  const messagingSenderId =
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim();

  const appId =
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim();

  /*
   * These five values are required for the browser
   * Firebase client. Do not silently construct a
   * partially configured Firebase instance.
   */
  if (
    !apiKey ||
    !authDomain ||
    !projectId ||
    !messagingSenderId ||
    !appId
  ) {
    return null;
  }

  const appCheckSiteKey =
    process.env
      .NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY?.trim();

  const useEmulators =
    process.env
      .NEXT_PUBLIC_USE_FIREBASE_EMULATORS ===
    "true";

  return {
    apiKey,
    authDomain,
    projectId,
    messagingSenderId,
    appId,
    appCheckSiteKey:
      appCheckSiteKey || undefined,
    useEmulators,
  };
}