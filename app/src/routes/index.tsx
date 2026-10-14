import "@/apollo.css";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

export const Route = createFileRoute("/")({ component: Index });

function Mark() {
  return <span className="apollo-mark" aria-hidden="true"><span /><span /><span /><span /></span>;
}


function Index() {
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  function enterWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authEmail.trim() || authPassword.length < 6) {
      setAuthNotice("Enter your email and a password with at least 6 characters.");
      return;
    }
    // Prototype-only gate. Replace with a real authentication provider before production use.
    localStorage.setItem("apollo-x-demo-session", JSON.stringify({ email: authEmail.trim(), createdAt: Date.now() }));
    window.location.href = "/workspace";
  }
  return (
    <main className="apollo-home ax-edu-home ax-login-home">
      <header className="apollo-nav ax-edu-nav ax-login-nav">
        <Link to="/" className="apollo-brand"><Mark /><span>Apollo<span className="apollo-brand-x">-X</span></span></Link>
        <span className="ax-login-nav-caption">THE RESEARCH INTELLIGENCE WORKSPACE</span>
        <button type="button" className="ax-login-help" onClick={() => setAuthNotice("This preview uses a demo sign-in. Secure account authentication must be connected before production.")}>Need help?</button>
      </header>
      <section className="ax-login-stage">
        <div className="ax-login-story">
          <p className="ax-edu-eyebrow"><span /> YOUR ENTIRE RESEARCH LANDSCAPE</p>
          <h1>Read less.<br/>Understand <em>everything.</em></h1>
          <p className="ax-login-lede">Bring research papers, articles, and documents into one place. Get the bigger picture with an overall summary of the findings, themes, disagreements, and open questions.</p>
          <div className="ax-login-points">
            <div><span>01</span><p><b>One overall summary</b><small>Combine insights across all retrieved papers and articles.</small></p></div>
            <div><span>02</span><p><b>Evidence you can trace</b><small>Jump from a summary back to its original sources.</small></p></div>
            <div><span>03</span><p><b>Connections made visible</b><small>Spot recurring themes, differences, and research gaps.</small></p></div>
          </div>
          <div className="ax-login-proof"><span className="ax-login-proof-dot"/> PAPERS · ARTICLES · SHARED FINDINGS · SOURCE LINKS</div>
        </div>
        <div className="ax-login-card-wrap">
          <div className="ax-login-card">
            <div className="ax-login-card-brand"><span className="ax-login-card-icon"><Mark /></span><span><b>Welcome to Apollo-X</b><small>Your next discovery starts here.</small></span></div>
            <div className="ax-login-tabs" role="tablist" aria-label="Account option">
              <button type="button" role="tab" aria-selected={authMode === "signin"} className={authMode === "signin" ? "active" : ""} onClick={() => {setAuthMode("signin");setAuthNotice("");}}>Sign in</button>
              <button type="button" role="tab" aria-selected={authMode === "signup"} className={authMode === "signup" ? "active" : ""} onClick={() => {setAuthMode("signup");setAuthNotice("");}}>Create account</button>
            </div>
            <h2>{authMode === "signin" ? "Pick up where you left off." : "Make space for better research."}</h2>
            <p className="ax-login-card-subtitle">{authMode === "signin" ? "Enter your details to open your research workspace." : "Set up your Apollo-X workspace preview."}</p>
            <form className="ax-login-form" onSubmit={enterWorkspace}>
              <label htmlFor="ax-login-email">Email address</label>
              <input id="ax-login-email" type="email" autoComplete="email" required value={authEmail} onChange={e => setAuthEmail(e.target.value)} placeholder="you@example.com" />
              <div className="ax-login-password-label"><label htmlFor="ax-login-password">Password</label><span>6+ characters</span></div>
              <input id="ax-login-password" type="password" autoComplete={authMode === "signin" ? "current-password" : "new-password"} minLength={6} required value={authPassword} onChange={e => setAuthPassword(e.target.value)} placeholder="Enter your password" />
              {authNotice && <p className="ax-login-notice" role="status">{authNotice}</p>}
              <button className="ax-login-submit" type="submit">{authMode === "signin" ? "Enter workspace" : "Create workspace"}<span>↗</span></button>
            </form>
            <div className="ax-login-secure-note"><span>✳</span><p><b>Research, all in one view</b><small>Search articles and papers, then generate a cross-source overview.</small></p></div>
            <p className="ax-login-disclaimer">Prototype sign-in only. Real account creation, password verification, and secure sessions are not connected yet.</p>
          </div>
          <div className="ax-login-card-foot"><span>APOLLO-X / RESEARCH INTELLIGENCE</span><span>01 — PRIVATE WORKSPACE</span></div>
        </div>
      </section>
      <footer className="apollo-footer ax-edu-footer ax-login-footer"><Link to="/" className="apollo-brand"><Mark /><span>Apollo<span className="apollo-brand-x">-X</span></span></Link><span>Research with a visible evidence trail.</span><span>© APOLLO-X</span></footer>
    </main>
  );
}
