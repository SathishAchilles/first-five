import type { MeResponse } from "@firstfive/shared";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Logo } from "../../components/layouts";
import { Alert, Button, Card, Field, Input } from "../../components/ui";
import { api, errorMessage, fieldErrors, post } from "../../lib/api";
import { useAuth } from "../../lib/auth";

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer: ReactNode }) {
  useEffect(() => {
    document.title = `${title} — First Five`;
  }, [title]);
  return (
    <div className="flex min-h-screen flex-col items-center bg-canvas px-4 py-10 sm:py-16">
      <Logo />
      <Card className="mt-8 w-full max-w-md p-6 sm:p-8">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-ink-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </Card>
      <p className="mt-6 text-sm text-ink-muted">{footer}</p>
    </div>
  );
}

function safeNext(next: string | null, fallback = "/app") {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : fallback;
}

export function LoginPage() {
  const { me, setMe } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  if (me) return <Navigate to={safeNext(params.get("next"))} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setFields({});
    try {
      const res = await post<MeResponse>("/api/auth/login", { email, password });
      setMe(res);
      navigate(safeNext(params.get("next")), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setFields(fieldErrors(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Log in to First Five"
      footer={
        <>
          New here?{" "}
          <Link to={`/signup${params.get("next") ? `?next=${encodeURIComponent(params.get("next")!)}` : ""}`} className="font-medium text-accent hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Email" error={fields.email}>
          {(p) => <Input {...p} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Password" error={fields.password}>
          {(p) => <Input {...p} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Button type="submit" className="w-full" loading={loading}>
          Log in
        </Button>
        <p className="text-center text-xs text-ink-muted">Forgot your password? Password reset by email isn't available yet — contact the First Five team.</p>
      </form>
    </AuthShell>
  );
}

export function SignupPage() {
  const { me, setMe } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showCode, setShowCode] = useState(Boolean(params.get("code")));
  const [code, setCode] = useState(params.get("code") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  if (me) return <Navigate to={safeNext(params.get("next"), me.entitlement.status === "active" ? "/app" : "/access")} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setFields({});
    try {
      const res = await post<MeResponse & { redemption: { planName: string } | null; redemptionError: string | null }>("/api/auth/signup", {
        name: name || undefined,
        email,
        password,
        invitationCode: showCode && code.trim() ? code.trim() : undefined,
      });
      setMe({ user: res.user, entitlement: res.entitlement });
      if (res.redemption) navigate(`/app/websites?welcome=${encodeURIComponent(res.redemption.planName)}`, { replace: true });
      else if (res.redemptionError) navigate("/redeem", { replace: true });
      else navigate(safeNext(params.get("next"), "/access"), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      const f = fieldErrors(err);
      if (f.code) {
        f.invitationCode = f.code;
        setShowCode(true);
      }
      setFields(f);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="One account for everything. You'll unlock a study with a ₹99 purchase or an invitation code."
      footer={
        <>
          Already have an account?{" "}
          <Link to={`/login${params.get("next") ? `?next=${encodeURIComponent(params.get("next")!)}` : ""}`} className="font-medium text-accent hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Your name" optional error={fields.name}>
          {(p) => <Input {...p} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="Email" error={fields.email}>
          {(p) => <Input {...p} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Password" hint="At least 10 characters." error={fields.password}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <div className="rounded-lg border border-line">
          <button
            type="button"
            onClick={() => setShowCode((s) => !s)}
            aria-expanded={showCode}
            className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Have an invitation code? (optional)
            {showCode ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
          </button>
          {showCode && (
            <div className="border-t border-line p-3">
              <Field label="Invitation code" hint="For judges and pilot partners. Looks like FF-XXXX-XXXX-XXXX-XXXX." error={fields.invitationCode}>
                {(p) => <Input {...p} autoComplete="off" spellCheck={false} className="font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value)} />}
              </Field>
            </div>
          )}
        </div>
        <Button type="submit" className="w-full" loading={loading}>
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}

/** One-time link for a client the First Five team onboarded: they choose their own password here. */
export function SetPasswordPage() {
  const { setMe } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [email, setEmail] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(token ? null : "This link is missing its token. Ask the First Five team for a new one.");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    api<{ email: string }>(`/api/auth/set-password?token=${encodeURIComponent(token)}`)
      .then((r) => setEmail(r.email))
      .catch((err) => setLinkError(errorMessage(err)));
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFields({});
    if (password !== confirm) {
      setFields({ confirm: "The passwords don't match" });
      return;
    }
    setLoading(true);
    try {
      const res = await post<MeResponse>("/api/auth/set-password", { token, password });
      setMe(res);
      navigate("/app", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setFields(fieldErrors(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Set your password"
      subtitle={email ? <>Your First Five account for {email} is ready. Choose a password to sign in.</> : undefined}
      footer={
        <>
          Already set it?{" "}
          <Link to="/login" className="font-medium text-accent hover:underline">
            Log in
          </Link>
        </>
      }
    >
      {linkError ? (
        <Alert tone="danger">{linkError}</Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Password" hint="At least 10 characters" error={fields.password}>
            {(p) => <Input {...p} type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
          <Field label="Confirm password" error={fields.confirm}>
            {(p) => <Input {...p} type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
          </Field>
          <Button type="submit" className="w-full" loading={loading} disabled={!email}>
            Set password and continue
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
