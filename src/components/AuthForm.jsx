import { useState } from "react";
import { Link } from "react-router-dom";
import {
  BookOpen,
  Eye,
  EyeOff,
  Loader2,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import Footer from "./Footer.jsx";
import { SITE } from "../data/site.js";
import "../styles/auth.css";

/**
 * Shared building blocks for the public authentication pages
 * (Sign in / Create account / Forgot password / Account).
 *
 * They keep the forms accessible and consistent: real <label> elements, visible
 * focus states, aria-invalid + aria-describedby on invalid fields, a polite
 * status region for confirmations and an assertive one for errors.
 */

/** Page shell: branded card + the standard site footer. */
export function AuthPage({ title, subtitle, children, wide = false }) {
  return (
    <main className="page-main">
      <div className="auth-layout">
        <div className={`auth-card${wide ? " auth-card-wide" : ""}`}>
          <Link className="auth-brand" to="/" title={`${SITE.heading} · Home`}>
            <span className="auth-brand-mark" aria-hidden="true">
              <BookOpen size={20} />
            </span>
            <span className="auth-brand-text">
              <strong>{SITE.heading}</strong>
              <em>{SITE.brand}</em>
            </span>
          </Link>

          <h1 className="auth-title">{title}</h1>
          {subtitle ? <p className="auth-sub">{subtitle}</p> : null}

          {children}
        </div>
      </div>
      <Footer />
    </main>
  );
}

/** Inline message. `error` is assertive; `success`/`info` are polite. */
export function AuthMessage({ tone = "error", children }) {
  const Icon =
    tone === "error" ? ShieldAlert : tone === "success" ? ShieldCheck : ShieldCheck;
  return (
    <p
      className={`auth-message auth-message-${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <Icon size={16} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/**
 * Labelled input with optional icon, hint, inline error and password reveal.
 */
export function AuthInput({
  id,
  label,
  icon: Icon,
  type = "text",
  value,
  onChange,
  autoComplete,
  placeholder,
  required = false,
  disabled = false,
  hint,
  error,
  reveal = false,
  autoFocus = false,
}) {
  const [show, setShow] = useState(false);
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;
  const inputType = reveal ? (show ? "text" : "password") : type;

  return (
    <div className={`auth-field${error ? " has-error" : ""}`}>
      <label className="auth-label" htmlFor={id}>
        {Icon ? <Icon size={14} aria-hidden="true" /> : null}
        {label}
      </label>

      <span className={`auth-input-wrap${reveal ? " has-reveal" : ""}`}>
        <input
          id={id}
          name={id}
          className="auth-input"
          type={inputType}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={describedBy}
        />
        {reveal ? (
          <button
            type="button"
            className="auth-reveal"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Hide password" : "Show password"}
            aria-pressed={show}
            disabled={disabled}
          >
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        ) : null}
      </span>

      {hint && !error ? (
        <p className="auth-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="auth-error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Primary submit button with a built-in loading state. */
export function AuthSubmit({
  children,
  loadingChildren,
  submitting = false,
  icon: Icon,
  disabled = false,
}) {
  return (
    <button
      type="submit"
      className="auth-submit"
      disabled={disabled || submitting}
    >
      {submitting ? (
        <>
          <Loader2 size={16} className="auth-spin" aria-hidden="true" />
          {loadingChildren || "Please wait…"}
        </>
      ) : (
        <>
          {Icon ? <Icon size={16} aria-hidden="true" /> : null}
          {children}
        </>
      )}
    </button>
  );
}

/** Small "or" separator used between the form and its alternative links. */
export function AuthAlt({ children }) {
  return <div className="auth-alt">{children}</div>;
}

/** Centred loading placeholder for the protected-route guard. */
export function AuthLoading({ label = "Loading…" }) {
  return (
    <div className="auth-loading" role="status">
      <Loader2 size={20} className="auth-spin" aria-hidden="true" />
      {label}
    </div>
  );
}
