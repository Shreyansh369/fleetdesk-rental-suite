"use client";

import {
  useEffect,
  useState,
} from "react";

import {
  backendMode,
  backendModeChosen,
  liveBackendAvailable,
  setBackendMode,
} from "@/lib/data/mode";

/*
 * Sign-in, registration and the trial only exist against the
 * live backend. Arriving at one of them from the demo switches
 * this browser to live with a full reload, so every module —
 * the auth listener above all — starts against Firebase rather
 * than the local store. A build without Firebase has no such
 * pages to offer and sends the visitor to the welcome page.
 */
export function LiveOnly({
  children,
}: {
  children: React.ReactNode;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!liveBackendAvailable()) {
      window.location.replace("/welcome");
      return;
    }

    if (backendMode() === "demo") {
      setBackendMode("live");
      window.location.reload();
      return;
    }

    if (!backendModeChosen()) {
      setBackendMode("live");
    }

    queueMicrotask(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div className="page-loader">
        <span className="loader-dot" />
        Opening FleetDesk…
      </div>
    );
  }

  return <>{children}</>;
}
