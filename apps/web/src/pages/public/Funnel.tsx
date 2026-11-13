import type { MeResponse, OrderStatusDto, PaidOffer } from "@firstfive/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, CheckCircle2, Clock, KeyRound, Lock, XCircle } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { MarketingFooter, MarketingHeader } from "../../components/layouts";
import { Alert, Button, CopyButton, Field, Input, Spinner, buttonClass } from "../../components/ui";
import { api, ApiError, errorMessage, fieldErrors, post } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { getUtm, track } from "../../lib/track";

/* Shell ------------------------------------------------------------------------------- */

export function FunnelShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <MarketingHeader />
      <main className="flex-1 bg-[radial-gradient(circle_at_90%_0%,#E3F3EB_0%,rgba(227,243,235,0)_40%)] px-4 py-10 sm:py-16">
        <div className={wide ? "mx-auto max-w-[880px]" : "mx-auto max-w-[480px]"}>{children}</div>
      </main>
      <MarketingFooter />
    </div>
  );
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[19px] border border-line bg-white p-6 shadow-soft sm:p-[29px] ${className}`}>{children}</div>;
}

function Kicker({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-extrabold uppercase tracking-[2px] text-accent">{children}</div>;
}

function SuccessIcon() {
  return (
    <div className="flex h-[50px] w-[50px] items-center justify-center rounded-full bg-[#E4F4E9] text-[#188066]" aria-hidden>
      <Check className="h-6 w-6" strokeWidth={3} />
    </div>
  );
}

/** Internal path only — prevents open redirects. */
export function safeInternalPath(p: string | null | undefined, fallback: string) {
  return p && p.startsWith("/") && !p.startsWith("//") && !p.startsWith("/\\") ? p : fallback;
}

/* Waitlist ----------------------------------------------------------------------------- */

export function WaitlistPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [v, setV] = useState({ name: "", email: "", productDescription: "", productUrl: "", website: "" });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => {
    document.title = "Join the waitlist — First Five";
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setFields({});
    try {
      const res = await post<{ status: "created" | "already_registered" }>("/api/waitlist", {
        ...v,
        productDescription: v.productDescription || undefined,
        productUrl: v.productUrl || undefined,
        source: params.get("from") ?? "direct",
        referrer: document.referrer ? document.referrer.slice(0, 300) : undefined,
        utm: getUtm(),
      });
      // Only after the server confirms the record is stored.
      navigate("/waitlist/success", { replace: true, state: { confirmed: true, status: res.status } });
    } catch (err) {
      // Keep everything the visitor typed so they can retry.
      setError(err instanceof ApiError && err.status === 0 ? "We couldn't reach First Five. Check your connection and try again." : errorMessage(err));
      setFields(fieldErrors(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <FunnelShell>
      <Panel>
        <Kicker>Free waitlist</Kicker>
        <h1 className="mb-2 mt-2 text-[26px] font-extrabold tracking-[-1px]">Be first to know.</h1>
        <p className="text-[14px] leading-[1.65] text-[#5F7169]">
          Interested in First Five but not ready to run a study? Join the list and we'll reach out when more access becomes available.
        </p>
        <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Your name" error={fields.name}>
            {(p) => <Input {...p} autoComplete="name" required maxLength={80} value={v.name} onChange={set("name")} />}
          </Field>
          <Field label="Email address" error={fields.email}>
            {(p) => <Input {...p} type="email" autoComplete="email" inputMode="email" required placeholder="you@example.com" value={v.email} onChange={set("email")} />}
          </Field>
          <Field label="What are you building?" optional error={fields.productDescription}>
            {(p) => <Input {...p} maxLength={300} placeholder="A web app, online store, …" value={v.productDescription} onChange={set("productDescription")} />}
          </Field>
          <Field label="Product URL" optional error={fields.productUrl}>
            {(p) => <Input {...p} type="url" inputMode="url" placeholder="https://" value={v.productUrl} onChange={set("productUrl")} />}
          </Field>
          {/* Honeypot: hidden from people and assistive tech. */}
          <div aria-hidden className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden">
            <label htmlFor="wl-website">Leave this empty</label>
            <input id="wl-website" tabIndex={-1} autoComplete="off" value={v.website} onChange={set("website")} />
          </div>
          <Button type="submit" size="lg" className="w-full" loading={loading}>
            Join waitlist <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
          <p className="text-[12px] leading-relaxed text-ink-muted">
            Joining the waitlist doesn't create an account or give product access. We'll only use your details to contact you about First Five.{" "}
            <Link to="/privacy" className="underline">
              Privacy
            </Link>
          </p>
        </form>
      </Panel>
      <p className="mt-6 text-center text-[13px] text-ink-muted">
        Ready to run a study now?{" "}
        <Link to="/access" className="font-semibold text-accent hover:underline">
          Get one study for ₹99
        </Link>
      </p>
    </FunnelShell>
  );
}

export function WaitlistSuccessPage() {
  const location = useLocation();
  const state = location.state as { confirmed?: boolean; status?: string } | null;
  // Never show a success state the server didn't confirm.
  if (!state?.confirmed) return <Navigate to="/waitlist" replace />;
  return (
    <FunnelShell>
      <Panel>
        <SuccessIcon />
        <h1 className="mb-2 mt-4 text-[26px] font-extrabold tracking-[-1px]">You're on the list!</h1>
        <p className="text-[14px] leading-[1.65] text-[#5F7169]">Thanks for your interest in First Five. We'll reach out when access becomes available.</p>
        {state.status === "already_registered" && <p className="mt-2 text-[13px] text-ink-muted">This email was already on our list, so we haven't added it twice.</p>}
        <Link to="/" className={buttonClass("primary", "lg", "mt-6 w-full")}>
          Back to homepage
        </Link>
      </Panel>
    </FunnelShell>
  );
}

/* Access (₹99 offer) -------------------------------------------------------------------- */

function useOffer() {
  return useQuery({ queryKey: ["offer"], queryFn: () => api<{ offer: PaidOffer }>("/api/billing/offer").then((r) => r.offer) });
}

const INCLUDED = ["One website and one key user journey", "Up to five invited participants — you recruit them", "Task outcomes and post-task feedback", "Individual participant views", "One consolidated AI research report"];

export function AccessPage() {
  const { me } = useAuth();
  const offer = useOffer();
  useEffect(() => {
    track("access_page_viewed");
    document.title = "Get access — First Five";
  }, []);
  const o = offer.data;
  const hasAccess = me?.entitlement.status === "active";
  const checkoutTarget = me ? "/checkout" : `/signup?next=${encodeURIComponent("/checkout")}`;

  return (
    <FunnelShell>
      <Panel>
        <Kicker>First Five · Early access</Kicker>
        <h1 className="mb-2 mt-2 text-[26px] font-extrabold tracking-[-1px]">One complete study. ₹99.</h1>
        <p className="text-[14px] leading-[1.65] text-[#5F7169]">One-time access to test one website journey with up to five invited participants.</p>

        {hasAccess && (
          <Alert tone="success" className="mt-5" title="You already have access">
            {me!.entitlement.creditsAvailable > 0
              ? `${me!.entitlement.creditsAvailable} unused study credit${me!.entitlement.creditsAvailable === 1 ? "" : "s"} on your account.`
              : "Your study credit is in use. Your existing work stays available."}{" "}
            <Link to="/app" className="font-semibold underline">
              Open your workspace
            </Link>
          </Alert>
        )}

        <div className="mt-5 rounded-[11px] border border-[#E1EEE5] bg-[#F2F8F4] p-[15px]">
          <div className="flex items-baseline gap-2">
            <strong className="text-[23px] font-extrabold">{o?.priceLabel ?? "₹99"}</strong>
            <span className="text-[12px] text-[#56695F]">one-time · no subscription</span>
          </div>
          <ul className="mt-2.5 space-y-1.5 text-[13px] text-[#4E6B5E]">
            {INCLUDED.map((t) => (
              <li key={t} className="flex gap-2">
                <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-[#169073]" strokeWidth={3} aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </div>

        {offer.isLoading ? (
          <Spinner label="Checking availability" />
        ) : o && !o.checkoutAvailable ? (
          <>
            <Alert tone="info" className="mt-5" title="Paid access isn't available yet.">
              We're finishing secure checkout. Join the free waitlist and we'll let you know, or use an invitation code if you have one.
            </Alert>
            <Button size="lg" className="mt-5 w-full" disabled>
              Continue with ₹99 access
            </Button>
            <Link to="/waitlist?from=access" className={buttonClass("secondary", "lg", "mt-3 w-full")}>
              Join free waitlist
            </Link>
          </>
        ) : (
          <>
            <Link to={checkoutTarget} className={buttonClass("primary", "lg", "mt-5 w-full")}>
              Continue with ₹99 access <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            {o?.paymentMethod === "upi_manual" && (
              <p className="mt-3 text-center text-[12px] leading-relaxed text-ink-muted">Pay by UPI. We confirm each payment by hand, usually within a few hours.</p>
            )}
          </>
        )}

        <div className="my-5 h-px bg-[#E2EBE5]" />
        <Link to="/redeem" className="flex items-center justify-center gap-2 text-[14px] font-bold text-accent underline underline-offset-[3px]">
          <KeyRound className="h-4 w-4" aria-hidden /> Have an invitation code?
        </Link>
        {!me && (
          <p className="mt-4 text-center text-[13px] text-ink-muted">
            Already have an account?{" "}
            <Link to="/login?next=/access" className="font-semibold text-accent hover:underline">
              Sign in
            </Link>
          </p>
        )}
      </Panel>
    </FunnelShell>
  );
}

/* Redeem invitation code ---------------------------------------------------------------- */

const REDEEM_MESSAGES: Record<string, string> = {
  invalid_code: "That code isn't valid. Check it and try again.",
  code_expired: "This code has expired.",
  code_disabled: "This code is no longer active.",
  code_exhausted: "This code has already been fully used.",
  already_redeemed: "You've already redeemed this code — its access is already on your account.",
  rate_limited: "Too many attempts. Please wait a few minutes and try again.",
};

export function RedeemPage() {
  const { me, loading, setMe } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ credits: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    document.title = "Redeem invitation code — First Five";
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return setError("Enter your invitation code.");
    setSubmitting(true);
    setError(null);
    try {
      const res = await post<MeResponse & { redemption: { studyCredits: number } }>("/api/access/redeem", { code: code.trim() });
      setMe({ user: res.user, entitlement: res.entitlement });
      setDone({ credits: res.redemption.studyCredits });
    } catch (err) {
      const c = err instanceof ApiError ? err.code : "";
      setError(REDEEM_MESSAGES[c] ?? (err instanceof ApiError && err.status >= 500 ? "Something went wrong on our side. Please try again." : errorMessage(err)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FunnelShell>
      <Panel>
        <Link to="/access" className="mb-3 inline-block text-[12px] font-bold text-[#447D6B] hover:underline">
          ← Back to access options
        </Link>
        <Kicker>Judge / invited pilot</Kicker>
        <h1 className="mb-2 mt-2 text-[26px] font-extrabold tracking-[-1px]">Have an invitation code?</h1>
        <p className="text-[14px] leading-[1.65] text-[#5F7169]">Enter your invitation code to unlock your complimentary First Five access.</p>

        {loading ? (
          <Spinner />
        ) : !me ? (
          <div className="mt-6 space-y-3">
            <p className="text-[13px] text-ink-muted">First, create an account or sign in. Your code unlocks access on that account.</p>
            <Link to={`/signup?next=${encodeURIComponent("/redeem")}`} className={buttonClass("primary", "lg", "w-full")}>
              Create an account
            </Link>
            <Link to={`/login?next=${encodeURIComponent("/redeem")}`} className={buttonClass("secondary", "lg", "w-full")}>
              Sign in
            </Link>
          </div>
        ) : done ? (
          <div className="mt-6">
            <SuccessIcon />
            <h2 className="mt-4 text-[18px] font-bold">Access unlocked.</h2>
            <p className="mt-1 text-[14px] text-[#5F7169]">
              Your account now has {done.credits} study credit{done.credits === 1 ? "" : "s"}. A credit is used when you launch a test.
            </p>
            <Button size="lg" className="mt-5 w-full" onClick={() => navigate("/app/websites")}>
              Go to your workspace <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            {error && <Alert tone="danger">{error}</Alert>}
            <Field label="Invitation code" hint={`Signed in as ${me.user.email}`}>
              {(p) => (
                <Input
                  {...p}
                  className="font-mono uppercase tracking-wider"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="FF-XXXX-XXXX-XXXX-XXXX"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              )}
            </Field>
            <Button type="submit" size="lg" className="w-full" loading={submitting}>
              Unlock access
            </Button>
          </form>
        )}
      </Panel>
    </FunnelShell>
  );
}

/* Checkout ------------------------------------------------------------------------------ */

export function CheckoutPage() {
  const { me, loading } = useAuth();
  const offer = useOffer();
  const navigate = useNavigate();
  const start = useMutation({
    mutationFn: () => post<{ orderId: string; redirectUrl: string }>("/api/payments/checkout", { planKey: "single_study" }),
    onSuccess: (r) => {
      if (offer.data?.paymentMethod === "upi_manual") navigate(`/payment/status?order=${r.orderId}`);
      // Hosted checkout on the provider's domain. Access is granted only after server-side verification.
      else window.location.assign(r.redirectUrl);
    },
  });
  if (loading) return <FunnelShell><Spinner /></FunnelShell>;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent("/checkout")}`} replace />;
  const o = offer.data;
  return (
    <FunnelShell>
      <Panel>
        <Kicker>Payment</Kicker>
        <h1 className="mb-2 mt-2 text-[26px] font-extrabold tracking-[-1px]">Get one study</h1>
        {offer.isLoading && <Spinner label="Checking availability" />}
        {o && !o.checkoutAvailable && (
          <>
            <Alert tone="info" className="mt-4" title="Paid access isn't available yet.">
              Secure checkout isn't open, so no payment can be taken. You won't be charged.
            </Alert>
            <div className="mt-5 space-y-3">
              <Link to="/redeem" className={buttonClass("primary", "lg", "w-full")}>
                Use an invitation code
              </Link>
              <Link to="/waitlist?from=checkout" className={buttonClass("secondary", "lg", "w-full")}>
                Join free waitlist
              </Link>
            </div>
          </>
        )}
        {o?.checkoutAvailable && (
          <>
            <div className="mt-4 flex items-baseline justify-between rounded-[11px] border border-[#E1EEE5] bg-[#F2F8F4] p-4">
              <span className="text-[14px] font-semibold">{o.name}</span>
              <span className="text-[20px] font-extrabold">{o.priceLabel}</span>
            </div>
            <p className="mt-3 text-[13px] text-ink-muted">
              One-time payment · No recurring charges. Total: {o.priceLabel}.{" "}
              {o.paymentMethod === "upi_manual"
                ? "You'll pay by UPI from any UPI app. We confirm each payment by hand — your study credit appears once it's confirmed, usually within a few hours."
                : "You'll pay on Pine Labs' secure page; card details never reach First Five."}
            </p>
            {o.environment === "uat" && (
              <Alert tone="warning" className="mt-3">
                Test mode: this checkout uses Pine Labs' sandbox. No real money is taken.
              </Alert>
            )}
            {start.error && (
              <Alert tone="danger" className="mt-3">
                {errorMessage(start.error)}
              </Alert>
            )}
            <Button size="lg" className="mt-5 w-full" icon={Lock} loading={start.isPending} onClick={() => start.mutate()}>
              {o.paymentMethod === "upi_manual" ? `Pay ${o.priceLabel} with UPI` : "Continue to secure checkout"}
            </Button>
          </>
        )}
      </Panel>
    </FunnelShell>
  );
}

/* Payment status (always read from the server) ----------------------------------------------- */

const PENDING = new Set(["created", "checkout_ready", "pending_verification"]);

export function PaymentStatusPage() {
  const { me, loading, refresh } = useAuth();
  const [params] = useSearchParams();
  const orderId = params.get("order");
  const started = useRef(Date.now());
  const q = useQuery({
    queryKey: ["order", orderId],
    queryFn: () => api<OrderStatusDto>(`/api/payments/orders/${orderId}`),
    enabled: Boolean(me && orderId && /^[0-9a-f-]{36}$/.test(orderId)),
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d || !PENDING.has(d.status)) return false;
      // UPI is confirmed by a person: check occasionally, without a time limit.
      if (d.method === "upi_manual") return d.status === "pending_verification" ? 30_000 : false;
      return Date.now() - started.current < 180_000 ? 4000 : false;
    },
  });
  useEffect(() => {
    if (q.data?.status === "paid_verified") void refresh();
  }, [q.data?.status]);

  if (loading) return <FunnelShell><Spinner /></FunnelShell>;
  // A logged-out visitor returning from checkout signs in, then resumes here.
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(`/payment/status?order=${orderId ?? ""}`)}`} replace />;

  const s = q.data?.status;
  let body: ReactNode;
  if (!orderId || q.error) {
    body = (
      <>
        <XCircle className="h-10 w-10 text-danger" aria-hidden />
        <h1 className="mt-4 text-[22px] font-extrabold">We couldn't find that payment</h1>
        <p className="mt-2 text-[14px] text-[#5F7169]">{q.error ? errorMessage(q.error) : "The link is missing an order reference."}</p>
      </>
    );
  } else if (q.isLoading || !s) {
    body = <Spinner label="Checking your payment" />;
  } else if (s === "paid_verified") {
    body = (
      <>
        <SuccessIcon />
        <h1 className="mt-4 text-[22px] font-extrabold">Payment verified.</h1>
        <p className="mt-2 text-[14px] text-[#5F7169]">Your study credit is ready. Connect your website and set up your test.</p>
        <Link to="/app/websites" className={buttonClass("primary", "lg", "mt-5 w-full")}>
          Go to your workspace
        </Link>
      </>
    );
  } else if (q.data?.method === "upi_manual" && s === "checkout_ready" && q.data.upi) {
    body = <UpiPayPanel order={q.data} onSubmitted={() => q.refetch()} />;
  } else if (q.data?.method === "upi_manual" && PENDING.has(s)) {
    body = (
      <>
        <Clock className="h-10 w-10 text-warning" aria-hidden />
        <h1 className="mt-4 text-[22px] font-extrabold">We're confirming your payment</h1>
        <p className="mt-2 text-[14px] leading-[1.65] text-[#5F7169]">
          We check every UPI payment by hand, usually within a few hours. Your study credit will appear here and in Settings as soon as it's confirmed. You
          can safely close this page.
        </p>
        <dl className="mt-4 space-y-1 rounded-[11px] border border-line bg-canvas p-4 text-[13px]">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-muted">Reference</dt>
            <dd className="font-mono font-semibold">{q.data.reference}</dd>
          </div>
          {q.data.submittedUtr && (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">UPI transaction ID</dt>
              <dd className="font-mono">{q.data.submittedUtr}</dd>
            </div>
          )}
        </dl>
      </>
    );
  } else if (PENDING.has(s)) {
    const timedOut = Date.now() - started.current >= 180_000;
    body = (
      <>
        <Clock className="h-10 w-10 text-warning" aria-hidden />
        <h1 className="mt-4 text-[22px] font-extrabold">{timedOut ? "Verification is taking longer than usual" : "Confirming your payment…"}</h1>
        <p className="mt-2 text-[14px] text-[#5F7169]">
          We only unlock access after Pine Labs confirms the payment with our server. {timedOut ? "You can safely leave this page; we'll update your account as soon as it's confirmed." : "This usually takes a few seconds."}
        </p>
        {timedOut && (
          <Button variant="secondary" className="mt-4" onClick={() => q.refetch()}>
            Check again
          </Button>
        )}
      </>
    );
  } else {
    const copy: Record<string, string> = {
      failed: "The payment didn't go through. You haven't been charged for a study credit.",
      cancelled: "Checkout was cancelled. You haven't been charged.",
      refunded: "This payment was refunded.",
      verification_error: "We couldn't verify this payment. Please contact the First Five team before trying again.",
    };
    body = (
      <>
        <XCircle className="h-10 w-10 text-danger" aria-hidden />
        <h1 className="mt-4 text-[22px] font-extrabold">Payment not completed</h1>
        <p className="mt-2 text-[14px] text-[#5F7169]">{copy[s] ?? "This payment wasn't completed."}</p>
        <Link to="/checkout" className={buttonClass("primary", "lg", "mt-5 w-full")}>
          Try again
        </Link>
      </>
    );
  }

  return (
    <FunnelShell>
      <Panel>
        {body}
        {q.data && (
          <p className="mt-5 border-t border-line pt-4 text-[12px] text-ink-muted">
            {q.data.planName} · {q.data.amountLabel}
            {q.data.environment === "uat" && " · Test mode (sandbox) — not a real charge"}
          </p>
        )}
      </Panel>
    </FunnelShell>
  );
}

/* UPI payment (manual confirmation) -------------------------------------------------------- */

function UpiPayPanel({ order, onSubmitted }: { order: OrderStatusDto; onSubmitted: () => void }) {
  const upi = order.upi!;
  const [qr, setQr] = useState<string | null>(null);
  const [utr, setUtr] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    let cancelled = false;
    import("qrcode")
      .then((QR) => QR.toDataURL(upi.uri, { margin: 1, width: 220, color: { dark: "#142B31", light: "#FFFFFF" } }))
      .then((url) => !cancelled && setQr(url))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [upi.uri]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await post(`/api/payments/orders/${order.id}/upi-reference`, { utr: utr.replace(/\s/g, "") });
      onSubmitted();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Kicker>Pay by UPI</Kicker>
      <h1 className="mb-1 mt-2 text-[24px] font-extrabold tracking-[-0.8px]">Pay {upi.amountLabel} to get one study</h1>
      <p className="text-[14px] leading-[1.65] text-[#5F7169]">Scan with any UPI app, or tap the button on your phone. Please keep the note as shown so we can match your payment.</p>
      <div className="mt-5 flex flex-col items-center gap-4 rounded-[13px] border border-line bg-canvas p-5 sm:flex-row sm:items-start">
        <div className="flex h-[180px] w-[180px] flex-none items-center justify-center rounded-lg bg-white p-2">
          {qr ? <img src={qr} alt={`UPI QR code to pay ${upi.amountLabel} to ${upi.payeeVpa}`} className="h-full w-full" /> : <Spinner label="Preparing QR" />}
        </div>
        <dl className="w-full space-y-2.5 text-[13px]">
          <div>
            <dt className="text-ink-muted">Pay to</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <span className="break-all font-mono font-semibold">{upi.payeeVpa}</span> <CopyButton text={upi.payeeVpa} label="Copy" />
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">Amount</dt>
            <dd className="font-semibold">{upi.amountLabel}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Note / reference</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-semibold">{upi.reference}</span> <CopyButton text={upi.reference} label="Copy" />
            </dd>
          </div>
        </dl>
      </div>
      <a href={upi.uri} className={buttonClass("primary", "lg", "mt-4 w-full sm:hidden")}>
        Open UPI app
      </a>
      <form onSubmit={submit} className="mt-6 space-y-3 border-t border-line pt-5" noValidate>
        <h2 className="text-[15px] font-bold">Paid? Tell us your UPI transaction ID</h2>
        <p className="text-[13px] text-ink-muted">Find the 12-digit UTR / UPI reference number in your UPI app's payment details.</p>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="UPI transaction ID (UTR)">
          {(p) => <Input {...p} inputMode="numeric" autoComplete="off" maxLength={14} placeholder="12 digits" className="font-mono tracking-wider" value={utr} onChange={(e) => setUtr(e.target.value)} />}
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={submitting} disabled={utr.replace(/\s/g, "").length < 12}>
          I've paid — submit
        </Button>
        <p className="text-[12px] text-ink-muted">Your study credit is added only after we confirm the payment arrived. Don't pay twice — if something went wrong, contact the First Five team with your reference.</p>
      </form>
    </>
  );
}

/* Legal drafts ---------------------------------------------------------------------------- */

function LegalDraft({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} — First Five`;
  }, [title]);
  return (
    <FunnelShell wide>
      <Panel>
        <Alert tone="warning" title="Draft — pending legal review">
          This page is a plain-language draft written by the product team. It has not been reviewed by a lawyer and must be reviewed and approved before First Five
          accepts live payments.
        </Alert>
        <h1 className="mt-6 text-[28px] font-extrabold tracking-[-1px]">{title}</h1>
        <div className="mt-4 space-y-4 text-[14px] leading-[1.75] text-[#3E5559] [&_h2]:mt-6 [&_h2]:text-[16px] [&_h2]:font-bold [&_h2]:text-ink">{children}</div>
      </Panel>
    </FunnelShell>
  );
}

export function PrivacyPage() {
  return (
    <LegalDraft title="Privacy">
      <h2>What we collect</h2>
      <p>
        <strong>Waitlist:</strong> your name, email, and optionally what you're building and its address, plus the campaign that brought you here (UTM tags).
      </p>
      <p>
        <strong>Builder accounts:</strong> your email, an optional name, and a securely hashed password. We store the websites and tests you create.
      </p>
      <p>
        <strong>Test participants:</strong> only while someone is doing a task they agreed to, the pages they visit and the buttons and links they click on the website
        being tested, plus any answers they choose to give afterwards. Participants are identified by an anonymous number. We never record what is typed into
        fields, passwords, or payment details. The builder who invited them sees their session, and First Five staff may view it to support that builder and check
        report quality.
      </p>
      <p>
        <strong>Site usage:</strong> a random visitor identifier stored in a first-party cookie to count page views and button clicks on this site. No third-party
        advertising trackers.
      </p>
      <h2>How we use it</h2>
      <p>To run the product, contact waitlist members about access, keep accounts secure, and measure whether the product is working. We don't sell personal data.</p>
      <h2>Payments</h2>
      <p>
        You pay by UPI from your own UPI app directly to First Five's UPI ID. We never see your bank or card details. We store the order, the payment
        reference and the UPI transaction ID you give us so we can confirm the payment.
      </p>
      <h2>Your choices</h2>
      <p>Participants can skip any question and withdraw during a test, which deletes their recorded activity. To delete an account or waitlist entry, contact the First Five team.</p>
    </LegalDraft>
  );
}

export function TermsPage() {
  return (
    <LegalDraft title="Terms">
      <h2>The service</h2>
      <p>
        First Five provides a usability-testing workflow: a script for your website, a test link for participants you invite, task outcomes, post-task feedback and a
        research report. You recruit your own testers.
      </p>
      <h2>The ₹99 study</h2>
      <p>
        A one-time purchase of one study credit: one website, one user journey, up to five eligible participant attempts and one consolidated research report. It is
        not a subscription. A credit is used when you launch a test.
      </p>
      <h2>Your responsibilities</h2>
      <p>
        Only install First Five on websites you control, tell participants what is recorded, and don't ask participants to enter sensitive personal or payment
        information during tests.
      </p>
      <h2>Results</h2>
      <p>Findings from a handful of participants are exploratory. They describe what those people did and said; they don't prove how all users will behave.</p>
    </LegalDraft>
  );
}
