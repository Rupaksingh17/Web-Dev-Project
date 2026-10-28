"use client";

import { useEffect } from "react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("CivicSignal page error", error);
  }, [error]);

  return (
    <main className="callback-page">
      <section className="callback-card" role="alert">
        <span className="signin-icon">!</span>
        <h1>That page ran into a problem</h1>
        <p>Try loading it again. If the problem continues, return to the report board.</p>
        <button className="button button-primary" onClick={reset}>Try again</button>
        <a href="/">Return to the report board</a>
      </section>
    </main>
  );
}
