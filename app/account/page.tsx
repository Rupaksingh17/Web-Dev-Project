"use client";

import { useEffect, useState } from "react";
import { beginCustomerLogin, getAdminToken, getCustomerToken, hasAdminSetup, signOutCustomer } from "@/lib/auth";

export default function AccountPage() {
  const [role, setRole] = useState<"customer" | "admin" | "signed-out">("signed-out");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (getAdminToken()) setRole("admin");
    else if (getCustomerToken()) setRole("customer");
  }, []);

  async function startLogin(mode: "login" | "signup") {
    setBusy(true);
    setError("");
    try {
      await beginCustomerLogin(mode);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start secure sign-in.");
      setBusy(false);
    }
  }

  return (
    <main className="account-page">
      <header className="site-header admin-header">
        <a className="brand" href="/"><span className="brand-mark" aria-hidden="true">⌂</span><span>Civic<span className="brand-light">Signal</span></span></a>
        <a className="back-link" href="/">← Back to community</a>
      </header>
      <section className="account-main">
        <div className="section-kicker"><span className="kicker-line" /> COMMUNITY ACCOUNT</div>
        <h1>{role === "admin" ? "Staff access" : role === "customer" ? "You’re signed in" : "Join your community"}</h1>
        <p className="account-intro">{role === "admin"
          ? "This account has administrator access. Use the staff workspace to manage report updates."
          : role === "customer"
            ? "Your community account is ready. You can now submit reports and add photos."
            : "Sign in or create an account to report local issues. The public report board stays open to everyone."}</p>

        <section className="account-card" aria-live="polite">
          {role === "signed-out" ? <>
            <span className="signin-icon">◎</span>
            <h2>Community sign-in</h2>
            <p>Accounts are managed securely by Amazon Cognito. New accounts may need to confirm their email before signing in.</p>
            {error && <p className="form-error" role="alert">{error}</p>}
            {hasAdminSetup() ? <div className="account-actions">
              <button className="button button-primary" onClick={() => void startLogin("login")} disabled={busy}>{busy ? "Opening secure sign-in…" : "Sign in"}</button>
              <button className="button button-outline" onClick={() => void startLogin("signup")} disabled={busy}>{busy ? "Please wait…" : "Create an account"}</button>
            </div> : <p className="setup-hint">Secure sign-in is not configured yet. Add the Cognito settings from the deployed AWS stack.</p>}
            <p className="account-note">Administrator access is assigned separately by the project owner. Customers cannot grant themselves staff permissions.</p>
          </> : <>
            <span className="signin-icon">✓</span>
            <h2>{role === "admin" ? "Administrator account" : "Community account"}</h2>
            <p>{role === "admin" ? "Your role is managed separately from customer accounts." : "You’re signed in and can submit a community report."}</p>
            <div className="account-actions">
              <a className="button button-primary" href={role === "admin" ? "/admin/" : "/"}>{role === "admin" ? "Open staff workspace" : "Go to community board"}</a>
              <button className="button button-outline" onClick={signOutCustomer}>Sign out</button>
            </div>
          </>}
          <div className="account-card-footer"><a href="/admin/">Staff sign-in ↗</a><span>Public reports can be read without an account.</span></div>
        </section>
      </section>
      <footer className="site-footer admin-footer"><a className="brand footer-brand" href="/"><span className="brand-mark">⌂</span><span>Civic<span className="brand-light">Signal</span></span></a><span>Community issue reporting</span><a href="/admin/">Staff workspace ↗</a><span className="footer-copy">Account</span></footer>
    </main>
  );
}
