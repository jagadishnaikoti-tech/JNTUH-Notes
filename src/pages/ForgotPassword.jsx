import { useState } from "react";
import { Link } from "react-router-dom";
import { Mail, Send } from "lucide-react";
import {
  AuthInput,
  AuthMessage,
  AuthPage,
  AuthSubmit,
} from "../components/AuthForm.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { authErrorMessage, isValidEmail } from "../lib/userAuth.js";

export default function ForgotPassword() {
  const { configured, sendPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState("");

  async function onSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    if (!isValidEmail(email)) {
      setFieldError("Enter a valid email address.");
      return;
    }
    setFieldError("");
    setError("");
    setSubmitting(true);
    try {
      await sendPasswordReset(email);
      // Always the same confirmation, whether or not the address has an account.
      setSent(true);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthPage
      title="Reset your password"
      subtitle="Enter the email address for your account and we'll send you a link to choose a new password."
    >
      {!configured ? (
        <AuthMessage tone="error">
          Password reset is not available right now because the site is not
          connected to its authentication service.
        </AuthMessage>
      ) : sent ? (
        <AuthMessage tone="success">
          If an account exists for <strong>{email.trim()}</strong>, a password
          reset link is on its way. Check your inbox and spam folder. The link
          expires after a short time.
        </AuthMessage>
      ) : (
        <form className="auth-form" onSubmit={onSubmit} noValidate>
          {error ? <AuthMessage>{error}</AuthMessage> : null}

          <AuthInput
            id="reset-email"
            label="Email"
            icon={Mail}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="you@example.com"
            error={fieldError}
            disabled={submitting}
            required
          />

          <AuthSubmit
            submitting={submitting}
            loadingChildren="Sending…"
            icon={Send}
          >
            Send reset link
          </AuthSubmit>
        </form>
      )}

      <p className="auth-alt">
        Remembered it? <Link to="/signin">Back to sign in</Link>
      </p>
    </AuthPage>
  );
}
