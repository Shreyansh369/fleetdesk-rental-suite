"use client";

import Link from "next/link";

import {
  useEffect,
  useState,
} from "react";

const KEY = "fleetdesk.cookie-notice";

/*
 * FleetDesk only stores what it needs to work, so there is
 * nothing to consent to (see /cookies). This tells people once,
 * and remembers that it has.
 */
export function CookieNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let seen = false;

    try {
      seen = window.localStorage.getItem(KEY) === "1";
    } catch {
      seen = false;
    }

    if (!seen) {
      queueMicrotask(() => setVisible(true));
    }
  }, []);

  if (!visible) {
    return null;
  }

  function dismiss() {
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      // Shown again next time; nothing else depends on it.
    }

    setVisible(false);
  }

  return (
    <div
      className="cookie-notice"
      role="region"
      aria-label="Cookie notice"
    >
      <p>
        FleetDesk stores only what it needs to work in your
        browser, such as keeping you signed in. No advertising or
        tracking cookies.{" "}
        <Link href="/cookies">Cookie policy</Link>
      </p>

      <button
        type="button"
        className="button button-secondary compact"
        onClick={dismiss}
      >
        OK
      </button>
    </div>
  );
}
