import { firebaseEnvironment } from "@/lib/firebase/config";

/*
 * Which backend the workspace runs against.
 *
 * "demo"  — everything runs in this browser against a local
 *           store. No account, no Firebase, nothing leaves the
 *           device. It is how a prospective operator tries the
 *           product with their own numbers before committing.
 * "live"  — the shared Firebase project, inside the workspace
 *           the signed-in account belongs to (a 7-day trial or a
 *           paid licence).
 *
 * A build without Firebase configuration can only ever be a
 * demo. A build with it lets the visitor choose, and remembers
 * the choice in this browser.
 */
export type BackendMode = "demo" | "live";

const STORAGE_KEY = "fleetdesk.mode";

let forced: BackendMode | null = null;

export function liveBackendAvailable(): boolean {
  return firebaseEnvironment() !== null;
}

function storedMode(): BackendMode | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const value =
      window.localStorage.getItem(STORAGE_KEY);

    return value === "demo" || value === "live"
      ? value
      : null;
  } catch {
    return null;
  }
}

export function backendMode(): BackendMode {
  if (forced) {
    return forced;
  }

  if (!liveBackendAvailable()) {
    return "demo";
  }

  return storedMode() ?? "live";
}

export function isDemoMode(): boolean {
  return backendMode() === "demo";
}

/*
 * True once the visitor has picked demo or live in this
 * browser. Until then the workspace sends them to the welcome
 * page — even on a demo-only build, so a first visit always
 * starts with what FleetDesk is and what it costs.
 */
export function backendModeChosen(): boolean {
  return storedMode() !== null;
}

/*
 * Every data module reads the mode when it is called, so a
 * change only takes effect cleanly on a fresh page load. The
 * caller navigates with a full load after setting it.
 */
export function setBackendMode(
  mode: BackendMode | null,
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (mode) {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Private windows may refuse storage; the default applies.
  }
}

/* Tests and scripts pin the mode explicitly. */
export function forceBackendMode(
  mode: BackendMode | null,
): void {
  forced = mode;
}

/*
 * A full page load, not a client-side navigation: after the mode
 * or the account's workspace changes, every listener has to start
 * again against the right backend, which only a fresh load does.
 */
export function reloadInto(path: string): void {
  window.location.assign(path);
}
