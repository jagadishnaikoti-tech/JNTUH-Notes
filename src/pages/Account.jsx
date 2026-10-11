import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  BadgeCheck,
  LogOut,
  MailCheck,
  RefreshCw,
  Save,
  ShieldAlert,
  User,
} from "lucide-react";
import {
  AuthInput,
  AuthMessage,
  AuthPage,
  AuthSubmit,
} from "../components/AuthForm.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { authErrorMessage } from "../lib/userAuth.js";

function formatDate(value) {
  const date = value?.toDate?.();
  if (!date) return null;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

/** The signed-in student's account page. Reached only through ProtectedRoute. */
export default function Account() {
  const {
    user,
    profile,
    displayName,
    initial,
    updateDisplayName,
    resendVerificationEmail,
    reload,
    signOut,
  } = useAuth();
  const navigate = useNavigate();

  const currentName = user?.displayName || "";
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveNotice, setSaveNotice] = useState("");

  const [verified, setVerified] = useState(Boolean(user?.emailVerified));
  const [resending, setResending] = useState(false);
  const [verifyNotice, setVerifyNotice] = useState("");

  useEffect(() => {
    setName(user?.displayName || "");
    setVerified(Boolean(user?.emailVerified));
  }, [user]);

  async function onSaveName(event) {
    event.preventDefault();
    if (saving) return;
    const clean = name.trim();
    if (!clean) {
      setSaveError("Enter the name you would like shown.");
      return;
    }
    setSaving(true);
    setSaveError("");
    setSaveNotice("");
    try {
      const saved = await updateDisplayName(user, clean);
      setName(saved);
      setSaveNotice("Your name has been updated.");
    } catch (err) {
      setSaveError(authErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function onResend() {
    if (resending) return;
    setResending(true);
    setVerifyNotice("");
    try {
      await resendVerificationEmail(user);
      setVerifyNotice("Verification email sent. Check your inbox and spam folder.");
    } catch (err) {
      setVerifyNotice(authErrorMessage(err));
    } finally {
      setResending(false);
    }
  }

  async function onRefreshVerification() {
    setVerifyNotice("");
    try {
      const refreshed = await reload(user);
      const nowVerified = Boolean(refreshed?.emailVerified ?? user?.emailVerified);
      setVerified(nowVerified);
      if (nowVerified) {
        setVerifyNotice("Thanks — your email address is now verified.");
      } else {
        setVerifyNotice("Still not verified. Open the link in the email we sent, then try again.");
      }
    } catch (err) {
      setVerifyNotice(authErrorMessage(err));
    }
  }

  async function onSignOut() {
    await signOut();
    navigate("/", { replace: true });
  }

  return (
    <AuthPage
      wide
      title="Your account"
      subtitle="Your sign-in details and the information shown with your account."
    >
      <div className="auth-account-head">
        <span className="auth-avatar auth-avatar-lg" aria-hidden="true">
          {initial}
        </span>
        <div className="auth-account-id">
          <p className="auth-account-name">{displayName}</p>
          <p className="auth-account-email">{user?.email}</p>
          <p className="auth-pills">
            {verified ? (
              <span className="auth-pill auth-pill-ok">
                <BadgeCheck size={14} aria-hidden="true" /> Email verified
              </span>
            ) : (
              <span className="auth-pill auth-pill-warn">
                <ShieldAlert size={14} aria-hidden="true" /> Email not verified
              </span>
            )}
            {profile?.createdAt ? (
              <span className="auth-pill">
                Member since {formatDate(profile.createdAt)}
              </span>
            ) : null}
          </p>
        </div>
      </div>

      {!verified ? (
        <section className="auth-subcard" aria-label="Verify your email">
          <h2 className="auth-section-title">Verify your email</h2>
          <p className="auth-section-sub">
            We sent a verification link to <strong>{user?.email}</strong>.
            Verifying your address helps keep your account secure.
          </p>
          {verifyNotice ? (
            <AuthMessage tone="info">{verifyNotice}</AuthMessage>
          ) : null}
          <div className="auth-inline-actions">
            <button
              type="button"
              className="auth-secondary"
              onClick={onResend}
              disabled={resending}
            >
              <MailCheckIcon spinning={resending} />
              {resending ? "Sending…" : "Resend verification email"}
            </button>
            <button type="button" className="auth-ghost" onClick={onRefreshVerification}>
              <RefreshCw size={15} aria-hidden="true" />
              I&apos;ve verified — refresh
            </button>
          </div>
        </section>
      ) : null}

      <form className="auth-form" onSubmit={onSaveName} noValidate>
        <h2 className="auth-section-title">Display name</h2>
        <p className="auth-section-sub">
          This name appears in the site header when you are signed in.
        </p>
        {saveError ? <AuthMessage>{saveError}</AuthMessage> : null}
        {saveNotice ? (
          <AuthMessage tone="success">{saveNotice}</AuthMessage>
        ) : null}
        <AuthInput
          id="account-name"
          label="Name"
          icon={User}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          placeholder="Your name"
          disabled={saving}
        />
        <AuthSubmit
          submitting={saving}
          loadingChildren="Saving…"
          icon={Save}
          disabled={!name.trim() || name.trim() === currentName}
        >
          Save changes
        </AuthSubmit>
      </form>

      <div className="auth-account-foot">
        <button type="button" className="auth-ghost" onClick={onSignOut}>
          <LogOut size={16} aria-hidden="true" />
          Sign out
        </button>
        <Link className="auth-inline-link" to="/privacy-policy">
          How your account data is handled
        </Link>
      </div>
    </AuthPage>
  );
}

/** Small spinner-or-icon for the resend button. */
function MailCheckIcon({ spinning }) {
  if (spinning) {
    return <RefreshCw size={15} className="auth-spin" aria-hidden="true" />;
  }
  return <MailCheck size={15} aria-hidden="true" />;
}
