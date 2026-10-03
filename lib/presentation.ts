import { FirebaseError } from "firebase/app";

export const currency =
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });

export function formatMoney(
  cents: number,
): string {
  return currency.format(
    cents / 100,
  );
}

export function formatDate(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions = {},
): string {
  if (!value) {
    return "Not recorded";
  }

  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat(
    "en-US",
    {
      month: "short",
      day: "numeric",
      year: "numeric",
      ...options,
    },
  ).format(date);
}

export function formatFuel(
  value: string,
): string {
  const labels: Record<
    string,
    string
  > = {
    one_eighth: "1/8",
    quarter: "1/4",
    three_eighths: "3/8",
    half: "1/2",
    five_eighths: "5/8",
    three_quarters: "3/4",
    seven_eighths: "7/8",
    full: "Full",
    empty: "Empty",
  };

  return (
    labels[value] ??
    value
      .replaceAll("_", " ")
      .replace(
        /\b\w/g,
        (letter) =>
          letter.toUpperCase(),
      )
  );
}

export function firebaseErrorMessage(
  error: unknown,
): string {
  if (
    !(error instanceof FirebaseError)
  ) {
    return error instanceof Error
      ? error.message
      : "Something went wrong. Please try again.";
  }

  const messages: Record<
    string,
    string
  > = {
    /*
     * Firebase Authentication
     */
    "auth/invalid-credential":
      "The email address or password is incorrect.",

    "auth/invalid-email":
      "Enter a valid email address.",

    "auth/invalid-api-key":
      "The Firebase web configuration is invalid. Check the deployed environment variables.",

    "auth/operation-not-allowed":
      "Email and password sign-in is not enabled in Firebase Authentication.",

    "auth/too-many-requests":
      "Too many attempts. Wait a moment before trying again or reset the password.",

    "auth/user-disabled":
      "This account has been disabled. Contact an administrator.",

    "auth/user-not-found":
      "The email address or password is incorrect.",

    "auth/wrong-password":
      "The email address or password is incorrect.",

    "auth/email-already-in-use":
      "An account with this email address already exists.",

    "auth/weak-password":
      "Choose a stronger password.",

    "auth/network-request-failed":
      "Network connection unavailable. Check your connection and try again.",

    /*
     * Firestore / direct Firebase client operations
     */
    "permission-denied":
      "Your account does not have permission for this action.",

    "unauthenticated":
      "Your session has expired. Sign in again.",

    "failed-precondition":
      error.message ||
      "This action cannot be completed in the current state.",

    "already-exists":
      error.message ||
      "A matching record already exists.",

    "invalid-argument":
      error.message ||
      "Check the information entered and try again.",

    "unavailable":
      "The service is temporarily unavailable. Please retry.",

    "not-found":
      "The requested record could not be found.",

    "aborted":
      "The operation was interrupted. Please try again.",

    "deadline-exceeded":
      "The operation took too long. Please try again.",
  };

  return (
    messages[error.code] ??
    error.message ??
    "This action could not be completed. Please try again."
  );
}