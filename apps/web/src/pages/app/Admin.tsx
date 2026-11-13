import type { AdminPaymentDto, InvitationCodeDto, ProviderStatusDto } from "@firstfive/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, RefreshCw } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ProviderBadge } from "../../components/status";
import { Outlet } from "react-router-dom";
import { Alert, Button, Card, CardHeader, CodeBlock, CopyButton, ErrorState, Field, Input, PageHeader, Pill, Select, Spinner, Tabs } from "../../components/ui";
import { api, errorMessage, post } from "../../lib/api";
import { formatDate, formatDateTime } from "../../lib/format";

interface Overview {
  acquisition: { waitlistLeads: number; registeredAccounts: number; accountsWithAccess: number; redeemedCodes: number };
  payments: { uatVerifiedOrders: number; liveVerifiedOrders: number };
  activation: { projects: number; connectedWebsites: number; launchedStudies: number };
  participants: { validAttempts: number; finalizedAttempts: number; attemptsWithFeedback: number };
  reports: { published: number };
  funnel: Record<string, { production: number; other: number }>;
}

const FUNNEL_ORDER = [
  "landing_page_viewed",
  "paid_cta_clicked",
  "waitlist_cta_clicked",
  "waitlist_submitted",
  "access_page_viewed",
  "signup_completed",
  "checkout_started",
  "payment_verified",
  "payment_failed",
  "invitation_code_redeemed",
  "workspace_activated",
  "project_created",
  "study_launched",
];

export function AdminLayout() {
  return (
    <div className="space-y-6">
      <PageHeader title="Superadmin" description="First Five operators only. Credentials are never shown here." />
      <Tabs
        tabs={[
          { to: "/app/admin", label: "Overview", end: true },
          { to: "/app/admin/clients", label: "Clients" },
          { to: "/app/admin/payments", label: "Payments" },
          { to: "/app/admin/codes", label: "Codes" },
          { to: "/app/admin/integrations", label: "Integrations" },
        ]}
      />
      <Outlet />
    </div>
  );
}

export function OverviewCard() {
  const q = useQuery({ queryKey: ["admin-overview"], queryFn: () => api<Overview>("/api/admin/overview") });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState message={errorMessage(q.error)} />;
  const o = q.data!;
  const row = (label: string, value: number) => (
    <div key={label} className="flex justify-between gap-3 text-sm">
      <span className="text-ink-muted">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
  return (
    <>
      <Card>
        <CardHeader title="Real activity" description="Populations are counted separately. Waitlist leads are not product users; sandbox payments are not revenue. Nothing here is seeded." />
        <div className="grid gap-6 p-5 sm:grid-cols-2 sm:p-6 lg:grid-cols-4">
          <div className="space-y-2">
            <div className="text-sm font-semibold">Acquisition</div>
            {row("Waitlist leads", o.acquisition.waitlistLeads)}
            {row("Registered accounts", o.acquisition.registeredAccounts)}
            {row("Accounts with access", o.acquisition.accountsWithAccess)}
            {row("Codes redeemed", o.acquisition.redeemedCodes)}
          </div>
          <div className="space-y-2">
            <div className="text-sm font-semibold">Payments</div>
            {row("Verified live purchases", o.payments.liveVerifiedOrders)}
            {row("Verified sandbox (UAT) payments", o.payments.uatVerifiedOrders)}
          </div>
          <div className="space-y-2">
            <div className="text-sm font-semibold">Activation</div>
            {row("Websites created", o.activation.projects)}
            {row("Connected websites", o.activation.connectedWebsites)}
            {row("Launched studies", o.activation.launchedStudies)}
            {row("Published reports", o.reports.published)}
          </div>
          <div className="space-y-2">
            <div className="text-sm font-semibold">Participants</div>
            {row("Valid attempts", o.participants.validAttempts)}
            {row("Finished attempts", o.participants.finalizedAttempts)}
            {row("Attempts with feedback", o.participants.attemptsWithFeedback)}
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Conversion events" description="Recorded only for completed actions. Payment events come from server-side verification." />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead className="bg-canvas text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-5 py-2 font-medium">Event</th>
                <th className="px-3 py-2 text-right font-medium">Production</th>
                <th className="px-3 py-2 text-right font-medium">Dev / test</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {FUNNEL_ORDER.map((n) => (
                <tr key={n}>
                  <td className="px-5 py-2 font-mono text-[13px]">{n}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{o.funnel[n]?.production ?? 0}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{o.funnel[n]?.other ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

export function PaymentsCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-payments"], queryFn: () => api<{ payments: AdminPaymentDto[] }>("/api/admin/payments"), refetchInterval: 60_000 });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "confirm" | "reject" }) => post<{ payments: AdminPaymentDto[] }>(`/api/admin/payments/${id}/${action}`),
    onSuccess: (r) => {
      qc.setQueryData(["admin-payments"], r);
      qc.invalidateQueries({ queryKey: ["admin-overview"] });
    },
  });
  const pending = (q.data?.payments ?? []).filter((p) => p.status === "pending_verification" || p.status === "checkout_ready");
  const done = (q.data?.payments ?? []).filter((p) => p.status === "paid_verified" || p.status === "failed");
  const STATUS: Record<string, string> = { checkout_ready: "Not yet submitted", pending_verification: "Awaiting your check", paid_verified: "Confirmed", failed: "Rejected" };
  return (
    <Card>
      <CardHeader
        title="UPI payments"
        description="Confirm only after you see the payment in your UPI or bank app — match the amount and the reference (in the note) or the UPI transaction ID. Confirming grants one study credit."
      />
      {q.isLoading && <Spinner />}
      {q.error && <p className="p-5 text-sm text-danger">{errorMessage(q.error)}</p>}
      {act.error && (
        <Alert tone="danger" className="m-5">
          {errorMessage(act.error)}
        </Alert>
      )}
      {q.data && q.data.payments.length === 0 && <p className="p-5 text-sm text-ink-muted sm:px-6">No UPI orders yet.</p>}
      {[...pending, ...done].length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-canvas text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-5 py-2 font-medium">Reference</th>
                <th className="px-3 py-2 font-medium">Buyer</th>
                <th className="px-3 py-2 font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">UTR</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[...pending, ...done].map((p) => (
                <tr key={p.orderId}>
                  <td className="px-5 py-2 font-mono">{p.reference}</td>
                  <td className="px-3 py-2">{p.buyerEmail}</td>
                  <td className="px-3 py-2">{p.amountLabel}</td>
                  <td className="px-3 py-2 font-mono">{p.utr ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Pill tone={p.status === "paid_verified" ? "success" : p.status === "failed" ? "neutral" : "warning"}>{STATUS[p.status] ?? p.status}</Pill>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {(p.status === "pending_verification" || p.status === "checkout_ready") && (
                      <>
                        <Button
                          size="sm"
                          disabled={act.isPending}
                          onClick={() =>
                            window.confirm(`Confirm you received ${p.amountLabel} with reference ${p.reference}${p.utr ? ` / UTR ${p.utr}` : ""}? This grants one study credit to ${p.buyerEmail}.`) &&
                            act.mutate({ id: p.orderId, action: "confirm" })
                          }
                        >
                          Confirm received
                        </Button>
                        <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => window.confirm("Reject this payment? No credit will be granted.") && act.mutate({ id: p.orderId, action: "reject" })}>
                          Reject
                        </Button>
                      </>
                    )}
                    {p.status === "failed" && p.correctable && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={act.isPending}
                        onClick={() =>
                          window.confirm(
                            `This payment was rejected. Confirm you DID receive ${p.amountLabel} with reference ${p.reference}${p.utr ? ` / UTR ${p.utr}` : ""}? This grants one study credit to ${p.buyerEmail} and is recorded as a correction.`,
                          ) && act.mutate({ id: p.orderId, action: "confirm" })
                        }
                      >
                        Confirm received
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function IntegrationsCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-integrations"], queryFn: () => api<{ providers: ProviderStatusDto[] }>("/api/admin/integrations") });
  const [message, setMessage] = useState<{ provider: string; text: string; ok: boolean } | null>(null);
  const verify = useMutation({
    mutationFn: (provider: string) => post<{ result: { ok: boolean; message: string }; providers: ProviderStatusDto[] }>(`/api/admin/integrations/${provider}/verify`),
    onSuccess: (r, provider) => {
      qc.setQueryData(["admin-integrations"], { providers: r.providers });
      setMessage({ provider, text: r.result.message, ok: r.result.ok });
    },
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState message={errorMessage(q.error)} />;
  return (
    <Card>
      <CardHeader title="Integrations" description="“Verified” only appears after an actual provider test succeeds. Setting credentials alone shows “Configured”." />
      <ul className="divide-y divide-line">
        {q.data!.providers.map((p) => (
          <li key={p.provider} className="px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 max-w-xl">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  <ProviderBadge status={p.status} />
                </div>
                <p className="mt-1 text-sm text-ink-muted">{p.description}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {p.configuredKeys.map((k) => (
                    <Pill key={k.key} tone={k.present ? "success" : "neutral"}>
                      <span className="font-mono">{k.key}</span> {k.present ? "set" : "missing"}
                    </Pill>
                  ))}
                </div>
                {p.provider === "ux_director" && p.details?.recentUsage != null && <UsageLine usage={p.details.recentUsage as Record<string, number>} />}
                {p.lastCheckedAt && (
                  <p className="mt-2 text-xs text-ink-muted">
                    Last checked {formatDateTime(p.lastCheckedAt)}
                    {p.lastError && ` — ${p.lastError}`}
                  </p>
                )}
              </div>
              <Button size="sm" variant="secondary" icon={RefreshCw} loading={verify.isPending && verify.variables === p.provider} onClick={() => verify.mutate(p.provider)}>
                Run verification
              </Button>
            </div>
            {message?.provider === p.provider && (
              <Alert tone={message.ok ? "success" : "warning"} className="mt-3">
                {message.text}
              </Alert>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function UsageLine({ usage: u }: { usage: Record<string, number> }) {
  const n = (v: number | undefined) => (v ?? 0).toLocaleString();
  return (
    <p className="mt-2 text-xs text-ink-muted">
      Last 7 days: {n(u.analyses)} analyses, {n(u.questions)} questions{u.failed ? `, ${n(u.failed)} failed` : ""} · {n(u.input_tokens)} input tokens ({n(u.cache_read_input_tokens)} cached),{" "}
      {n(u.output_tokens)} output tokens
    </p>
  );
}

export function CodesCard() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["admin-codes"], queryFn: () => api<{ codes: InvitationCodeDto[] }>("/api/admin/codes") });
  const [label, setLabel] = useState("");
  const [audience, setAudience] = useState("judge");
  const [count, setCount] = useState(1);
  const [uses, setUses] = useState(1);
  const [expires, setExpires] = useState(30);
  const [credits, setCredits] = useState(1);
  const [cap, setCap] = useState(5);
  const [generated, setGenerated] = useState<string[] | null>(null);
  const gen = useMutation({
    mutationFn: () => post<{ codes: string[] }>("/api/admin/codes", { label, audience, planKey: "complimentary", studyCredits: credits, participantCap: cap, count, maxRedemptions: uses, expiresInDays: expires }),
    onSuccess: (r) => {
      setGenerated(r.codes);
      qc.invalidateQueries({ queryKey: ["admin-codes"] });
    },
  });
  const disable = useMutation({ mutationFn: (id: string) => post(`/api/admin/codes/${id}/disable`), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-codes"] }) });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    gen.mutate();
  };
  return (
    <Card>
      <CardHeader title="Invitation codes" description="Complimentary access for judges and pilot users. Codes are shown once; only a secure verifier is stored." />
      <form onSubmit={submit} className="grid gap-4 border-b border-line p-5 sm:grid-cols-6 sm:p-6">
        <div className="sm:col-span-2">
          <Field label="Label">{(p) => <Input {...p} placeholder="AI Builders Day judges" value={label} onChange={(e) => setLabel(e.target.value)} />}</Field>
        </div>
        <Field label="For">
          {(p) => (
            <Select {...p} value={audience} onChange={(e) => setAudience(e.target.value)}>
              <option value="judge">Judges</option>
              <option value="pilot">Pilot users</option>
              <option value="partner">Partners</option>
              <option value="internal">Internal</option>
            </Select>
          )}
        </Field>
        <Field label="Codes">{(p) => <Input {...p} type="number" min={1} max={50} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} />}</Field>
        <Field label="Uses each">{(p) => <Input {...p} type="number" min={1} max={1000} value={uses} onChange={(e) => setUses(Number(e.target.value) || 1)} />}</Field>
        <Field label="Expires (days)">{(p) => <Input {...p} type="number" min={1} max={365} value={expires} onChange={(e) => setExpires(Number(e.target.value) || 30)} />}</Field>
        <Field label="Study credits">{(p) => <Input {...p} type="number" min={1} max={20} value={credits} onChange={(e) => setCredits(Number(e.target.value) || 1)} />}</Field>
        <Field label="Testers per study">{(p) => <Input {...p} type="number" min={1} max={50} value={cap} onChange={(e) => setCap(Number(e.target.value) || 5)} />}</Field>
        <div className="sm:col-span-6">
          <Button type="submit" icon={KeyRound} loading={gen.isPending} disabled={!label.trim()}>
            Generate codes
          </Button>
          {gen.error && <p className="mt-2 text-sm text-danger">{errorMessage(gen.error)}</p>}
        </div>
      </form>
      {generated && (
        <div className="space-y-3 border-b border-line bg-warning-soft/40 p-5 sm:p-6">
          <Alert tone="warning" title="Copy these now">
            They won't be shown again.
          </Alert>
          <CodeBlock code={generated.join("\n")} />
          <CopyButton text={generated.join("\n")} label="Copy all codes" />
        </div>
      )}
      {list.data && list.data.codes.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-canvas text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-5 py-2 font-medium">Label</th>
                <th className="px-3 py-2 font-medium">Ends in</th>
                <th className="px-3 py-2 font-medium">Grants</th>
                <th className="px-3 py-2 font-medium">Used</th>
                <th className="px-3 py-2 font-medium">Expires</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.data.codes.map((c) => (
                <tr key={c.id}>
                  <td className="px-5 py-2">
                    {c.label} <span className="text-ink-muted">· {c.audience}</span>
                  </td>
                  <td className="px-3 py-2 font-mono">…{c.codeHint}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {c.studyCredits} study · {c.participantCap} testers
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {c.redemptionCount} / {c.maxRedemptions}
                  </td>
                  <td className="px-3 py-2">{c.expiresAt ? formatDate(c.expiresAt) : "Never"}</td>
                  <td className="px-3 py-2">{c.disabledAt ? <Pill>Disabled</Pill> : <Pill tone="success">Active</Pill>}</td>
                  <td className="px-3 py-2 text-right">
                    {!c.disabledAt && (
                      <Button size="sm" variant="ghost" onClick={() => window.confirm("Disable this code?") && disable.mutate(c.id)}>
                        Disable
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
