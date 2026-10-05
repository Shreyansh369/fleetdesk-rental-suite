"use client";

import Link from "next/link";

import {
  useEffect,
  useState,
} from "react";

import {
  liveBackendAvailable,
  reloadInto,
  setBackendMode,
} from "@/lib/data/mode";

/*
 * The header of every public page: the welcome page, pricing and
 * the legal pages. Its two actions set the mode before loading
 * the page, so the sign-in that opens is the right one.
 */
export function SiteHeader() {
  const [live, setLive] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setLive(liveBackendAvailable()));
  }, []);

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link className="site-brand" href="/welcome">
          <img
            src="/icon.svg"
            alt=""
            width={28}
            height={28}
          />
          <span>FleetDesk</span>
        </Link>

        <nav aria-label="Site">
          <Link href="/welcome#features">Features</Link>
          <Link href="/welcome#pricing">Pricing</Link>
          {live && (
            <button
              type="button"
              className="site-link"
              onClick={() => {
                setBackendMode("live");
                reloadInto("/login");
              }}
            >
              Sign in
            </button>
          )}
          <button
            type="button"
            className="button button-primary compact"
            onClick={() => {
              setBackendMode("demo");
              reloadInto("/login");
            }}
          >
            Open the demo
          </button>
        </nav>
      </div>
    </header>
  );
}
