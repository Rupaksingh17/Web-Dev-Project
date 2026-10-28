"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, listReports, updateReportStatus } from "@/lib/api";
import { beginAdminLogin, clearAdminToken, getAdminToken, hasAdminSetup, signOutAdmin } from "@/lib/auth";
import { type Report, type ReportStatus, STATUSES } from "@/lib/types";

const statusLabels: Record<ReportStatus, string> = {
  REPORTED: "Reported",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
};

export default function AdminPage() {
  const [signedIn, setSignedIn] = useState(false);
  const [reports, setReports] = useState<Report[]>([]);
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const page = await listReports();
      setReports(page.items);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        clearAdminToken();
        setSignedIn(false);
      }
      setError(reason instanceof Error ? reason.message : "Could not load reports.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setSignedIn(Boolean(getAdminToken()));
  }, []);

  useEffect(() => {
    if (signedIn) void refresh();
  }, [signedIn, refresh]);

  async function login() {
    setError("");
    if (!hasAdminSetup()) { setError("Administrator sign-in is not configured. Add the Cognito settings from the deployed AWS stack."); return; }
    try {
      await beginAdminLogin();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start sign-in.");
    }
  }

  async function changeStatus(reportId: string, status: ReportStatus) {
    setBusyIds((current) => new Set(current).add(reportId));
    setError("");
    try {
      const updated = await updateReportStatus(reportId, status);
      setReports((current) => current.map((report) => report.reportId === reportId ? updated : report));
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        clearAdminToken();
        setSignedIn(false);
      }
      setError(reason instanceof Error ? reason.message : "Could not update this report.");
    } finally {
      setBusyIds((current) => { const next = new Set(current); next.delete(reportId); return next; });
    }
  }

  function logout() {
    setSignedIn(false);
    signOutAdmin();
  }

  return (
    <main className="admin-page">
      <header className="site-header admin-header"><a className="brand" href="/"><span className="brand-mark" aria-hidden="true">⌂</span><span>Civic<span className="brand-light">Signal</span></span></a><a className="back-link" href="/">← Back to community</a></header>
      <section className="admin-main">
        <div className="admin-heading"><div><div className="section-kicker"><span className="kicker-line" /> COMMUNITY CARE TEAM</div><h1>Report management</h1><p>Keep neighbors in the loop by sharing what’s happening with each report.</p></div>{signedIn && <button className="button button-outline" onClick={logout}>Sign out</button>}</div>
        {!signedIn ? <section className="admin-signin"><span className="signin-icon">↗</span><h2>Administrator sign-in</h2><p>Sign in to review community reports and share status updates.</p>{error && <p className="form-error" role="alert">{error}</p>}{hasAdminSetup() ? <button className="button button-primary" onClick={login}>Continue with secure sign-in ↗</button> : <p className="setup-hint">Deploy the AWS backend and set the Cognito environment variables to enable administrator sign-in.</p>}</section> : <section className="admin-board"><div className="admin-board-heading"><div><h2>Community reports</h2><p>{reports.length} reports loaded</p></div><button className="button button-outline refresh-button" onClick={() => void refresh()} disabled={loading}>{loading ? "Refreshing…" : "↻ Refresh"}</button></div>{error && <div className="form-error" role="alert">{error}</div>}{!loading && reports.length === 0 && <div className="empty-state"><h3>No reports yet</h3><p>New community reports will appear here.</p></div>}<div className="admin-report-list">{reports.map((report) => <article className="admin-report-row" key={report.reportId}><div className="admin-report-icon">{report.photoUrl ? <span style={{ backgroundImage: `url("${report.photoUrl}")` }} /> : <span>◎</span>}</div><div className="admin-report-info"><h3>{report.title}</h3><p>{report.category} <span>·</span> {report.locationLabel}</p><small>Submitted {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(report.createdAt))}</small></div><label className="status-control"><span>Status</span><select aria-label={`Change status for ${report.title}`} value={report.status} disabled={busyIds.has(report.reportId)} onChange={(event) => void changeStatus(report.reportId, event.target.value as ReportStatus)}>{STATUSES.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label></article>)}</div></section>}
      </section>
      <footer className="site-footer admin-footer"><a className="brand footer-brand" href="/"><span className="brand-mark">⌂</span><span>Civic<span className="brand-light">Signal</span></span></a><span>Every update helps build trust.</span><a href="/">View community site ↗</a><span className="footer-copy">Admin</span></footer>
    </main>
  );
}
