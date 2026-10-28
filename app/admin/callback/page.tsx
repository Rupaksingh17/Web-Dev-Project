"use client";

import { useEffect, useRef, useState } from "react";
import { completeLogin } from "@/lib/auth";

export default function AdminCallbackPage() {
  const [message, setMessage] = useState("Completing secure sign-in…");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const query = new URLSearchParams(window.location.search);
    const providerError = query.get("error_description") ?? query.get("error");
    const code = query.get("code");
    const state = query.get("state");
    if (providerError || !code || !state) {
      setMessage(providerError ?? "The sign-in link expired. Return to the admin page and try again.");
      return;
    }
    completeLogin(code, state).then((role) => {
      let next = role === "admin" ? "/admin/" : "/account/";
      try {
        const returnToReport = sessionStorage.getItem("civic-signal-after-login") === "report";
        sessionStorage.removeItem("civic-signal-after-login");
        if (role === "customer" && returnToReport) next = "/?new=1";
      } catch { /* The normal account route remains available without storage. */ }
      window.location.replace(next);
    }).catch((reason: unknown) => {
      setMessage(reason instanceof Error ? reason.message : "Sign-in could not be completed.");
    });
  }, []);

  return <main className="callback-page"><div className="callback-card"><span className="callback-spinner" /><h1>Secure sign-in</h1><p>{message}</p><a href="/account/">Return to community sign-in</a><span className="callback-separator">·</span><a href="/admin/">Staff sign-in</a></div></main>;
}
