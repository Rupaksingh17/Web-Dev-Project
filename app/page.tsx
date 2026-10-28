"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, createReport, isKnownCategory, listReports } from "@/lib/api";
import { getCustomerToken } from "@/lib/auth";
import { CATEGORIES, type Category, type NewReport, type Report } from "@/lib/types";

const statusText = { REPORTED: "Reported", IN_PROGRESS: "In progress", RESOLVED: "Resolved" } as const;

function relativeDate(value: string) {
  const time = new Date(value).getTime();
  const days = Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value));
}

function Pin({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" stroke="currentColor" strokeWidth="1.8"/><circle cx="12" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.8"/></svg>;
}

function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="m16 4 13 7H3l13-7Z" fill="currentColor"/><path d="M6 13h20v2H6zm2 3h3v9H8zm6 0h4v9h-4zm7 0h3v9h-3zM5 27h22v2H5z" fill="currentColor"/></svg></span>;
}

function ReportCard({ report, onSelect }: { report: Report; onSelect: (report: Report) => void }) {
  return (
    <button className="report-card" onClick={() => onSelect(report)} type="button">
      <div className="report-card-symbol" aria-hidden="true">{report.photoUrl ? <span className="report-card-photo" style={{ backgroundImage: `url("${report.photoUrl}")` }} /> : <Pin />}</div>
      <div className="report-card-body">
        <div className="report-card-top"><span className="report-category">{report.category}</span><span className={`status-pill status-${report.status.toLowerCase()}`}><i />{statusText[report.status]}</span></div>
        <h3>{report.title}</h3>
        <p>{report.description}</p>
        <div className="report-location"><Pin /><span>{report.locationLabel}</span><span className="report-date">{relativeDate(report.createdAt)}</span></div>
      </div>
    </button>
  );
}

function ReportDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (report: Report) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [locationBusy, setLocationBusy] = useState(false);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const locationRef = useRef<HTMLInputElement>(null);

  async function useLocation() {
    if (!navigator.geolocation) { setError("Location is not available in this browser."); return; }
    setLocationBusy(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = { latitude: Number(position.coords.latitude.toFixed(6)), longitude: Number(position.coords.longitude.toFixed(6)) };
        setCoords(next);
        if (locationRef.current && !locationRef.current.value.trim()) locationRef.current.value = `${next.latitude}, ${next.longitude}`;
        setLocationBusy(false);
      },
      () => { setError("Could not get your location. You can enter a street or landmark instead."); setLocationBusy(false); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const category = String(form.get("category"));
    if (!isKnownCategory(category)) { setError("Choose an issue category."); return; }
    const input: NewReport = {
      title: String(form.get("title") ?? "").trim(),
      description: String(form.get("description") ?? "").trim(),
      category: category as Category,
      locationLabel: String(form.get("location") ?? "").trim(),
      ...(coords ?? {}),
    };
    if (input.title.length < 6 || input.title.length > 100) { setError("Give your report a title between 6 and 100 characters."); return; }
    if (input.description.length < 20) { setError("Add a little more detail (at least 20 characters)."); return; }
    if (input.locationLabel.length < 3) { setError("Add a street, intersection, or nearby landmark."); return; }
    setBusy(true);
    try {
      const photo = photoRef.current?.files?.[0];
      const report = await createReport(input, photo);
      onCreated(report);
      onClose();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        try { sessionStorage.setItem("civic-signal-after-login", "report"); } catch { /* Continue to sign-in without the return hint. */ }
        window.location.assign("/account/");
        return;
      }
      setError(reason instanceof Error ? reason.message : "Your report could not be submitted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="report-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div className="dialog-heading"><div><span className="eyebrow">PUBLIC ISSUE REPORT</span><h2 id="dialog-title">What needs attention?</h2><p>Add the location and details someone would need to find the issue.</p></div><button className="icon-button close-button" onClick={onClose} type="button" aria-label="Close report form">×</button></div>
        <form className="report-form" onSubmit={submit}>
          <label>What needs attention?<input name="title" maxLength={100} required placeholder="e.g. Broken streetlight on Pine Street" /></label>
          <div className="form-row"><label>Issue type<select name="category" defaultValue="" required><option value="" disabled>Choose a category</option>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label><label>Where is it?<span className="location-input-wrap"><input ref={locationRef} name="location" maxLength={180} required placeholder="Street, crossing, or landmark" /><button type="button" onClick={useLocation} title="Use my current location" aria-label="Use my current location">{locationBusy ? "…" : <Pin />}</button></span></label></div>
          <label>Tell us a little more<textarea name="description" minLength={20} maxLength={1500} rows={4} required placeholder="What happened? Is there anything nearby that helps people find it?" /></label>
          <label className="upload-box"><span className="upload-icon">＋</span><span><b>Add a photo <small>(optional)</small></b><small>JPG, PNG or WebP · up to 5 MB</small></span><input ref={photoRef} type="file" accept="image/jpeg,image/png,image/webp" /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-footer"><span><span className="privacy-mark">✓</span> Submitted with your community account</span><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Sending report…" : "Submit report →"}</button></div>
        </form>
      </section>
    </div>
  );
}

function DetailDialog({ report, onClose }: { report: Report; onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="detail-dialog" role="dialog" aria-modal="true" aria-labelledby="detail-title"><button className="icon-button detail-close" onClick={onClose} type="button" aria-label="Close details">×</button>{report.photoUrl && <div className="detail-photo" style={{ backgroundImage: `url("${report.photoUrl}")` }} />}<div className="detail-content"><span className={`status-pill status-${report.status.toLowerCase()}`}><i />{statusText[report.status]}</span><div className="report-meta detail-meta"><span>{report.category}</span><span className="meta-dot" />{relativeDate(report.createdAt)}</div><h2 id="detail-title">{report.title}</h2><p className="detail-description">{report.description}</p><div className="detail-address"><Pin /><div><small>LOCATION</small><b>{report.locationLabel}</b></div>{report.latitude !== undefined && report.longitude !== undefined && <a href={`https://www.openstreetmap.org/?mlat=${report.latitude}&mlon=${report.longitude}#map=17/${report.latitude}/${report.longitude}`} target="_blank" rel="noreferrer">Open map ↗</a>}</div><div className="detail-timeline"><span className="timeline-dot" /><div><b>{statusText[report.status]}</b><small>Last updated {relativeDate(report.updatedAt)}</small></div></div></div></section></div>;
}

export default function HomePage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [nextToken, setNextToken] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [selected, setSelected] = useState<Report | null>(null);
  const [notice, setNotice] = useState("");
  const [customerSignedIn, setCustomerSignedIn] = useState(false);

  useEffect(() => {
    setCustomerSignedIn(Boolean(getCustomerToken()));
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") {
      window.history.replaceState(null, "", window.location.pathname);
      if (getCustomerToken()) setFormOpen(true);
      else window.location.assign("/account/");
    }
  }, []);

  function requestNewReport() {
    if (!getCustomerToken()) {
      try { sessionStorage.setItem("civic-signal-after-login", "report"); } catch { /* Login still works without the return hint. */ }
      window.location.assign("/account/");
      return;
    }
    setFormOpen(true);
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    listReports({ category: categoryFilter, status: statusFilter }).then((page) => {
      if (active) { setReports(page.items); setNextToken(page.nextToken ?? ""); setLoadError(""); }
    }).catch((error: unknown) => {
      if (active) setLoadError(error instanceof Error ? error.message : "Could not load community reports.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [categoryFilter, statusFilter]);

  async function loadMore() {
    if (!nextToken || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listReports({ category: categoryFilter, status: statusFilter, nextToken });
      setReports((current) => [...current, ...page.items]);
      setNextToken(page.nextToken ?? "");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load more reports.");
    } finally {
      setLoadingMore(false);
    }
  }

  const filteredReports = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return reports;
    return reports.filter((report) => `${report.title} ${report.description} ${report.locationLabel} ${report.category}`.toLowerCase().includes(needle));
  }, [reports, search]);

  function addReport(report: Report) {
    setCategoryFilter("");
    setStatusFilter("");
    setSearch("");
    setReports((current) => [report, ...current]);
    setNotice("Your report is in. Thanks for looking out for your neighborhood.");
    window.setTimeout(() => setNotice(""), 6000);
  }

  return (
    <main>
      <header className="site-header"><a className="brand" href="#top"><BrandMark /><span>Civic<span className="brand-light">Signal</span><small className="brand-subtitle">COMMUNITY ISSUE DESK</small></span></a><nav className="main-nav"><a href="#reports">Report board</a><a href="#how-it-works">How it works</a></nav><div className="header-actions"><a className="admin-link" href="/account/">{customerSignedIn ? "My account" : "Community sign-in"}</a><a className="admin-link staff-signin-link" href="/admin/">Staff sign-in</a><button className="button button-primary header-cta" onClick={requestNewReport}>＋ <span>New report</span></button></div></header>
      <section className="hero" id="top"><div className="hero-copy"><div className="hero-kicker"><span className="kicker-line" /> PUBLIC SPACE · COMMUNITY REPORTS</div><h1>Help local problems get <em>noticed.</em></h1><p className="hero-description">Report an issue on your street or in a shared space. Add a location, explain what you saw, then follow its status on the public board.</p><div className="hero-buttons"><button className="button button-dark" onClick={requestNewReport}>Start a report <span>↗</span></button><a className="text-link" href="#reports">View the report board <span>↓</span></a></div><div className="hero-proof"><span className="proof-check">✓</span><p><b>Sign in to submit</b><br />Everyone can browse the public report board.</p></div></div><div className="workflow-panel" id="how-it-works"><div className="workflow-panel-head"><span>REPORT STATUS</span><span>PUBLIC RECORD</span></div><div className="workflow-step"><span className="workflow-number">01</span><div><b>Reported</b><small>The issue is added to the board.</small></div><i className="step-dot reported-dot" /></div><div className="workflow-step"><span className="workflow-number">02</span><div><b>In progress</b><small>An update shows work has started.</small></div><i className="step-dot progress-dot" /></div><div className="workflow-step"><span className="workflow-number">03</span><div><b>Resolved</b><small>The board records the latest status.</small></div><i className="step-dot resolved-dot" /></div><div className="workflow-panel-foot"><Pin /><span>Use a street, crossing, landmark, or your current location.</span></div></div><div className="hero-footnote"><span>COMMUNITY SERVICE BOARD</span><span>·</span><span>REPORTS STAY OPEN TO THE PUBLIC</span></div></section>
      <section className="values-strip"><div className="value-item"><span className="value-icon green-icon">01</span><div><b>Describe the issue</b><small>Choose a category and add useful details.</small></div></div><div className="value-item"><span className="value-icon peach-icon">02</span><div><b>Mark the place</b><small>Enter a nearby street or landmark.</small></div></div><div className="value-item"><span className="value-icon blue-icon">03</span><div><b>Follow the update</b><small>Check the report status on this board.</small></div></div></section>
      <section className="reports-section" id="reports"><div className="section-heading"><div><div className="section-kicker"><span className="kicker-line" /> COMMUNITY SERVICE DESK</div><h2>Latest community reports</h2><p>Read recent reports, check their status, or add a location that needs attention.</p></div><button className="button button-outline" onClick={requestNewReport}>＋ New report</button></div>
        <div className="filters"><label className="search-box"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" stroke="currentColor" strokeWidth="1.8"/><path d="m16 16 4.2 4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search an issue or place…" aria-label="Search reports" /></label><select aria-label="Filter by issue type" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">All issue types</option>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select><select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Every status</option><option value="REPORTED">Reported</option><option value="IN_PROGRESS">In progress</option><option value="RESOLVED">Resolved</option></select><span className="report-count">{filteredReports.length} {filteredReports.length === 1 ? "report" : "reports"}</span></div>
        {notice && <div className="success-notice" role="status"><span>✓</span>{notice}<button onClick={() => setNotice("")} aria-label="Dismiss">×</button></div>}
        {loadError && <div className="empty-state error-state"><span>!</span><h3>Report board unavailable</h3><p>{loadError}</p><button className="button button-outline" onClick={() => window.location.reload()}>Reconnect</button></div>}
        {loading && <div className="loading-grid" aria-label="Loading reports"><span /><span /><span /></div>}
        {!loading && !loadError && filteredReports.length > 0 && <><div className="reports-grid">{filteredReports.map((report) => <ReportCard key={report.reportId} report={report} onSelect={setSelected} />)}</div>{nextToken && <div className="load-more-wrap"><button className="button button-outline" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? "Loading reports…" : "Load more reports ↓"}</button></div>}</>}
        {!loading && !loadError && filteredReports.length === 0 && <div className="empty-state"><span>⌕</span><h3>{reports.length ? "No reports match that search" : "A better block starts with one report"}</h3><p>{reports.length ? "Try another keyword or clear a filter." : "Be the first to flag something your community should know about."}</p><button className="button button-outline" onClick={() => { setSearch(""); setCategoryFilter(""); setStatusFilter(""); if (!reports.length) requestNewReport(); }}>{reports.length ? "Clear filters" : "Report the first issue"}</button></div>}
      </section>
      <section className="closing-cta"><div className="public-record-tag">PUBLIC RECORD</div><div><div className="section-kicker">A NOTE BEFORE YOU SUBMIT</div><h2>Keep the report focused on the place and problem.</h2><p>Reports can be read by anyone. Leave out names, phone numbers, and other private details.</p></div><button className="button button-light" onClick={requestNewReport}>Write a report <span>↗</span></button></section>
      <footer className="site-footer"><a className="brand footer-brand" href="#top"><BrandMark /><span>Civic<span className="brand-light">Signal</span></span></a><span>Community issue reporting</span><a href="/admin/">Staff sign-in ↗</a><span className="footer-copy">© {new Date().getFullYear()} CivicSignal</span></footer>
      {formOpen && <ReportDialog onClose={() => setFormOpen(false)} onCreated={addReport} />}
      {selected && <DetailDialog report={selected} onClose={() => setSelected(null)} />}
    </main>
  );
}
