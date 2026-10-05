"use client";

import {
  useEffect,
  useState,
} from "react";

import {
  backendMode,
  liveBackendAvailable,
  setBackendMode,
} from "@/lib/data/mode";

import { DemoLogin } from "./demo-login";
import { LiveOnly } from "./live-only";
import { LoginForm } from "./login-form";

/*
 * /login serves both front doors: the demo's sign-in, with its
 * published accounts, or the live workspace's. Which one is the
 * mode this browser is in; a build without Firebase only has
 * the demo.
 */
export function LoginEntry() {
  const [mode, setMode] = useState<
    "demo" | "live" | null
  >(null);

  useEffect(() => {
    const current = liveBackendAvailable()
      ? backendMode()
      : "demo";

    if (current === "demo") {
      setBackendMode("demo");
    }

    queueMicrotask(() => setMode(current));
  }, []);

  if (mode === "demo") {
    return <DemoLogin />;
  }

  if (mode === "live") {
    return (
      <LiveOnly>
        <LoginForm />
      </LiveOnly>
    );
  }

  return (
    <div className="page-loader">
      <span className="loader-dot" />
      Opening sign in
    </div>
  );
}
