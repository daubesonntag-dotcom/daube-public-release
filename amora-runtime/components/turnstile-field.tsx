"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

const SITE_KEY = String(process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY || "").trim();

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action?: string;
      theme?: "auto" | "light" | "dark";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => boolean;
    }
  ) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function turnstileConfigured() {
  return Boolean(SITE_KEY);
}

export function TurnstileField({
  action,
  onToken,
  resetKey = 0,
}: {
  action: string;
  onToken: (token: string) => void;
  resetKey?: number;
}) {
  const [ready, setReady] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetRef = useRef<string | null>(null);
  const callbackRef = useRef(onToken);

  useEffect(() => {
    callbackRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    const api = window.turnstile;
    const container = containerRef.current;
    if (!SITE_KEY || !ready || !api || !container) return;

    if (widgetRef.current) {
      try { api.remove(widgetRef.current); } catch {}
      widgetRef.current = null;
    }
    container.replaceChildren();
    callbackRef.current("");

    widgetRef.current = api.render(container, {
      sitekey: SITE_KEY,
      action: action.slice(0, 32),
      theme: "auto",
      callback: (token) => callbackRef.current(token),
      "expired-callback": () => callbackRef.current(""),
      "error-callback": () => {
        callbackRef.current("");
        return true;
      },
    });

    return () => {
      if (widgetRef.current) {
        try { api.remove(widgetRef.current); } catch {}
        widgetRef.current = null;
      }
    };
  }, [action, ready, resetKey]);

  if (!SITE_KEY) return null;

  return (
    <>
      <Script
        id="daube-cloudflare-turnstile"
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={() => setReady(true)}
        onReady={() => setReady(true)}
      />
      <div ref={containerRef} data-daube-turnstile-action={action} />
    </>
  );
}
