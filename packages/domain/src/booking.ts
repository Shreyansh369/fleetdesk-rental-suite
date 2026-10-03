/** Two years is as far back as a booking may be dated. */
const MAX_BACKDATE_MS = 2 * 365 * 86_400_000;

export interface PickupWindow {
  pickupAtMs: number;
  nowMs: number;
  /** The rental already started; the office is recording it late. */
  backdated: boolean;
}

/**
 * Whether a booking may be taken for this pickup instant, and why not when it
 * may not.
 *
 * An ordinary booking promises a vehicle for a window that has not started, so
 * its pickup is ahead of now. A rental the office began before this system was
 * keeping its books is the exception: the vehicle is already out, so the pickup
 * is behind us. It is still a booking rather than a past rental, because it has
 * not been handed back and has to be checked out, extended and returned like
 * any other.
 *
 * The exception is deliberate rather than a relaxation: a backdated booking is
 * required to be in the past, exactly as an ordinary one is required to be in
 * the future, so neither can be entered by mistyping a date in the other one's
 * form. The two-year bound catches the mistyped year that would otherwise file
 * an ongoing rental in the last decade.
 */
export function pickupWindowError(window: PickupWindow): string | null {
  if (!Number.isFinite(window.pickupAtMs)) return "Enter a valid pickup time.";

  if (!window.backdated) {
    return window.pickupAtMs < window.nowMs ? "Pickup time cannot be in the past. Tick “this rental already started” to record a booking that is already running." : null;
  }

  if (window.pickupAtMs > window.nowMs) {
    return "A booking that already started cannot be picked up in the future.";
  }

  if (window.nowMs - window.pickupAtMs > MAX_BACKDATE_MS) {
    return "A booking cannot be backdated by more than two years. Record a rental that old as a past booking on the customer's record.";
  }

  return null;
}
