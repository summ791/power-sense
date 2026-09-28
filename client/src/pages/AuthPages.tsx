import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  FileCheck2,
  LockKeyhole,
  LogOut,
  LogIn,
  Mail,
  ShieldCheck,
  UserRound,
  Zap,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { supabaseConfigured } from "../services/supabase";

function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Power Sense home">
      <span className="brand-mark">
        <Zap size={23} strokeWidth={2.5} />
      </span>
      <span>
        <span className="brand-title">POWER SENSE</span>
        <span className="brand-subtitle">Electricity utility portal</span>
      </span>
    </Link>
  );
}

function AuthFrame({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="auth-page">
      <header className="auth-header container">
        <Brand />
        <Link className="text-link" href="/">
          Back to home <ArrowRight size={15} />
        </Link>
      </header>
      <main className="auth-main container">
        <section className="auth-card" aria-labelledby="auth-title">
          <div className="auth-icon">
            <ShieldCheck size={22} />
          </div>
          <div className="eyebrow">SECURE ACCOUNT ACCESS</div>
          <h1 id="auth-title" className="auth-title">
            {title}
          </h1>
          <p className="auth-description">{description}</p>
          {!supabaseConfigured && (
            <div className="auth-message error" role="alert">
              Account access is not configured. Please contact the site
              administrator.
            </div>
          )}
          {children}
        </section>
      </main>
      <footer className="auth-footer">
        Bill data and uploaded source documents are private to the signed-in
        account.
      </footer>
    </div>
  );
}

function FormFeedback({
  error,
  success,
}: {
  error?: string;
  success?: string;
}) {
  if (error)
    return (
      <div className="auth-message error" role="alert">
        {error}
      </div>
    );
  if (success)
    return (
      <div className="auth-message success" role="status">
        <CheckCircle2 size={17} /> <span>{success}</span>
      </div>
    );
  return null;
}

function readableError(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}

function safeNextPath() {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function PublicLandingPage() {
  return (
    <div className="auth-page landing-page">
      <header className="auth-header container">
        <Brand />
        <div className="auth-header-actions">
          <Link className="text-link" href="/login">
            Sign in
          </Link>
          <Link className="button button-primary" href="/signup">
            Create account <ArrowRight size={15} />
          </Link>
        </div>
      </header>
      <main className="landing-main container">
        <section className="landing-hero">
          <div className="landing-copy">
            <div className="eyebrow light">DIGITAL CONSUMPTION SERVICES</div>
            <h1>Understand your electricity bills with confidence.</h1>
            <p>
              Review bill details, follow your usage over time, and explore a
              data-based forecast — all in a private account that keeps your
              records and source documents together.
            </p>
            <div className="flex flex-wrap gap-3 mt-6">
              <Link className="button button-light" href="/signup">
                Create your account <ArrowRight size={16} />
              </Link>
              <Link className="button button-ghost-light" href="/login">
                <LogIn size={16} /> Sign in
              </Link>
            </div>
          </div>
          <div className="landing-seal">
            <ShieldCheck size={34} />
            <strong>PRIVATE BY ACCOUNT</strong>
            <span>
              Your bills and uploaded files are isolated to your account.
            </span>
          </div>
        </section>
        <section className="landing-features" aria-label="Portal features">
          <article className="panel">
            <FileCheck2 size={23} />
            <h2>Review bills</h2>
            <p>
              Extract and check bill details before saving them to your account.
            </p>
          </article>
          <article className="panel">
            <Eye size={23} />
            <h2>Track consumption</h2>
            <p>View your saved usage history and compare billing periods.</p>
          </article>
          <article className="panel">
            <LockKeyhole size={23} />
            <h2>Account privacy</h2>
            <p>
              Saved records and source files are protected by account-level
              access rules.
            </p>
          </article>
        </section>
      </main>
      <footer className="auth-footer">
        OCR and forecast values are estimates. Review extracted details against
        your official bill.
      </footer>
    </div>
  );
}

export function LoginPage() {
  const { signIn, configured } = useAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await signIn(email, password);
      navigate(safeNextPath());
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame
      title="Welcome back"
      description="Sign in to view your saved bills and account analytics."
    >
      <form className="auth-form" onSubmit={submit}>
        <label className="auth-field">
          <span>Email address</span>
          <span className="auth-input-wrap">
            <Mail size={17} />
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={event => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </span>
        </label>
        <label className="auth-field">
          <span>Password</span>
          <span className="auth-input-wrap">
            <LockKeyhole size={17} />
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={event => setPassword(event.target.value)}
              placeholder="Enter your password"
            />
          </span>
        </label>
        <div className="auth-inline-link">
          <Link href="/forgot-password">Forgot password?</Link>
        </div>
        <FormFeedback error={error} />
        <button
          className="button button-primary auth-submit"
          disabled={!configured || busy}
        >
          {busy ? "Signing in…" : "Sign in"}
          {!busy && <ArrowRight size={16} />}
        </button>
      </form>
      <p className="auth-switch">
        New to Power Sense? <Link href="/signup">Create an account</Link>
      </p>
    </AuthFrame>
  );
}

export function SignUpPage() {
  const { signUp, configured } = useAuth();
  const [, navigate] = useLocation();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const result = await signUp(email, password, fullName);
      if (result.emailConfirmationRequired) {
        setSuccess(
          "Account created. Check your email to confirm your address, then sign in."
        );
      } else {
        navigate("/");
      }
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame
      title="Create your account"
      description="Your bills and uploaded files will be stored privately under your account."
    >
      <form className="auth-form" onSubmit={submit}>
        <label className="auth-field">
          <span>Full name</span>
          <span className="auth-input-wrap">
            <UserRound size={17} />
            <input
              type="text"
              autoComplete="name"
              required
              value={fullName}
              onChange={event => setFullName(event.target.value)}
              placeholder="Your name"
            />
          </span>
        </label>
        <label className="auth-field">
          <span>Email address</span>
          <span className="auth-input-wrap">
            <Mail size={17} />
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={event => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </span>
        </label>
        <label className="auth-field">
          <span>
            Password <small>(at least 8 characters)</small>
          </span>
          <span className="auth-input-wrap">
            <LockKeyhole size={17} />
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={event => setPassword(event.target.value)}
              placeholder="Create a password"
            />
          </span>
        </label>
        <label className="auth-field">
          <span>Confirm password</span>
          <span className="auth-input-wrap">
            <LockKeyhole size={17} />
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={confirmPassword}
              onChange={event => setConfirmPassword(event.target.value)}
              placeholder="Enter your password again"
            />
          </span>
        </label>
        <FormFeedback error={error} success={success} />
        <button
          className="button button-primary auth-submit"
          disabled={!configured || busy}
        >
          {busy ? "Creating account…" : "Create account"}
          {!busy && <ArrowRight size={16} />}
        </button>
      </form>
      <p className="auth-switch">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </AuthFrame>
  );
}

export function ForgotPasswordPage() {
  const { sendPasswordReset, configured } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    setBusy(true);
    try {
      await sendPasswordReset(email);
      setSuccess(
        "If an account exists for that email, a password reset link will be sent."
      );
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame
      title="Reset your password"
      description="Enter your account email and we’ll send instructions to reset your password."
    >
      <form className="auth-form" onSubmit={submit}>
        <label className="auth-field">
          <span>Email address</span>
          <span className="auth-input-wrap">
            <Mail size={17} />
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={event => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </span>
        </label>
        <FormFeedback error={error} success={success} />
        <button
          className="button button-primary auth-submit"
          disabled={!configured || busy}
        >
          {busy ? "Sending…" : "Send reset link"}
          {!busy && <ArrowRight size={16} />}
        </button>
      </form>
      <p className="auth-switch">
        Remembered your password? <Link href="/login">Sign in</Link>
      </p>
    </AuthFrame>
  );
}

export function ResetPasswordPage() {
  const { updatePassword, configured } = useAuth();
  const [, navigate] = useLocation();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await updatePassword(password);
      navigate("/");
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame
      title="Choose a new password"
      description="Set a new password for your Power Sense account."
    >
      <form className="auth-form" onSubmit={submit}>
        <label className="auth-field">
          <span>New password</span>
          <span className="auth-input-wrap">
            <LockKeyhole size={17} />
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={event => setPassword(event.target.value)}
              placeholder="At least 8 characters"
            />
          </span>
        </label>
        <label className="auth-field">
          <span>Confirm new password</span>
          <span className="auth-input-wrap">
            <LockKeyhole size={17} />
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={confirmPassword}
              onChange={event => setConfirmPassword(event.target.value)}
              placeholder="Enter it again"
            />
          </span>
        </label>
        <FormFeedback error={error} />
        <button
          className="button button-primary auth-submit"
          disabled={!configured || busy}
        >
          {busy ? "Updating…" : "Update password"}
          {!busy && <ArrowRight size={16} />}
        </button>
      </form>
      <p className="auth-switch">
        <Link href="/login">Return to sign in</Link>
      </p>
    </AuthFrame>
  );
}

export function AccountPage() {
  const { user, updateDisplayName, updatePassword, signOut } = useAuth();
  const [, navigate] = useLocation();
  const [fullName, setFullName] = useState(
    String(user?.user_metadata?.full_name ?? "")
  );
  const [nameMessage, setNameMessage] = useState("");
  const [nameError, setNameError] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [logoutError, setLogoutError] = useState("");
  const [busy, setBusy] = useState(false);

  const logout = async () => {
    setLogoutError("");
    try {
      await signOut();
      navigate("/login");
    } catch (reason) {
      setLogoutError(readableError(reason));
    }
  };

  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    setNameError("");
    setNameMessage("");
    setBusy(true);
    try {
      await updateDisplayName(fullName);
      setNameMessage("Profile name updated.");
    } catch (reason) {
      setNameError(readableError(reason));
    } finally {
      setBusy(false);
    }
  };

  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordError("");
    setPasswordMessage("");
    if (password.length < 8) {
      setPasswordError("Use a password with at least 8 characters.");
      return;
    }
    if (password !== passwordConfirm) {
      setPasswordError("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await updatePassword(password);
      setPassword("");
      setPasswordConfirm("");
      setPasswordMessage("Password updated.");
    } catch (reason) {
      setPasswordError(readableError(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="account-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">ACCOUNT SETTINGS</div>
          <h1>Your profile</h1>
          <p>Manage your sign-in details and account profile.</p>
        </div>
        <button className="button button-secondary" onClick={logout}>
          <LogOut size={15} /> Sign out
        </button>
      </div>
      <FormFeedback error={logoutError} />
      <section className="panel account-panel">
        <div className="panel-heading">
          <div>
            <div className="panel-kicker">PROFILE</div>
            <h2>Account information</h2>
          </div>
          <div className="auth-icon small">
            <UserRound size={19} />
          </div>
        </div>
        <p className="account-email">
          <strong>Email</strong>
          <span>{user?.email ?? ""}</span>
        </p>
        <form className="auth-form" onSubmit={saveName}>
          <label className="auth-field">
            <span>Display name</span>
            <span className="auth-input-wrap">
              <UserRound size={17} />
              <input
                value={fullName}
                onChange={event => setFullName(event.target.value)}
                autoComplete="name"
              />
            </span>
          </label>
          <FormFeedback error={nameError} success={nameMessage} />
          <button className="button button-primary" disabled={busy}>
            Save profile
          </button>
        </form>
      </section>
      <section className="panel account-panel">
        <div className="panel-heading">
          <div>
            <div className="panel-kicker">SECURITY</div>
            <h2>Change password</h2>
          </div>
          <div className="auth-icon small">
            <LockKeyhole size={19} />
          </div>
        </div>
        <form className="auth-form" onSubmit={savePassword}>
          <label className="auth-field">
            <span>New password</span>
            <span className="auth-input-wrap">
              <LockKeyhole size={17} />
              <input
                type="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </span>
          </label>
          <label className="auth-field">
            <span>Confirm new password</span>
            <span className="auth-input-wrap">
              <LockKeyhole size={17} />
              <input
                type="password"
                value={passwordConfirm}
                onChange={event => setPasswordConfirm(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </span>
          </label>
          <FormFeedback error={passwordError} success={passwordMessage} />
          <button className="button button-primary" disabled={busy}>
            Update password
          </button>
        </form>
      </section>
      <div className="privacy-card account-privacy">
        <ShieldCheck size={19} />
        <div>
          <strong>Your saved data is account-specific</strong>
          <p>
            Bill records and uploaded source documents are protected by database
            and Storage access policies.
          </p>
        </div>
      </div>
    </div>
  );
}
