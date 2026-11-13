import type { AdminClientDetail, AdminGrantDto, AdminStudyDto, SessionListItem } from "@firstfive/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, Button, Card, CardHeader, ErrorState, Field, Input, KeyValue, Pill, Spinner, Textarea } from "../../../components/ui";
import { api, errorMessage, post } from "../../../lib/api";
import { formatDate, formatDateTime, timeAgo } from "../../../lib/format";
import { FlagPill } from "./Clients";

type ActionKind = "grant" | "view";

export function AdminClientDetailPage() {
  const { clientId } = useParams();
  const q = useQuery({ queryKey: ["admin-client", clientId], queryFn: () => api<AdminClientDetail>(`/api/admin/clients/${clientId}`) });
  const [open, setOpen] = useState<ActionKind | null>(null);

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const c = d.client;

  return (
    <div className="space-y-6">
      <Link to="/app/admin/clients" className="text-sm text-ink-muted hover:text-ink">
        ← Clients
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">{c.email}</h2>
          <p className="text-sm text-ink-muted">
            {c.name ? `${c.name} · ` : ""}Signed up {formatDate(c.createdAt)} · Last seen {c.lastSeenAt ? timeAgo(c.lastSeenAt) : "never"}
            {c.waitlistJoinedAt && ` · On waitlist since ${formatDate(c.waitlistJoinedAt)}`}
          </p>
          {c.flags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {c.flags.map((f) => (
                <FlagPill key={f} flag={f} />
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={Eye} onClick={() => setOpen(open === "view" ? null : "view")}>
            View as client
          </Button>
          <Button onClick={() => setOpen(open === "grant" ? null : "grant")}>Grant access</Button>
        </div>
      </div>

      {open === "view" && <ViewAsForm clientId={c.id} onCancel={() => setOpen(null)} />}
      {open === "grant" && (
        <ActionForm
          title="Grant access"
          path={`/api/admin/clients/${c.id}/grants`}
          clientId={c.id}
          onDone={() => setOpen(null)}
          fields={[
            { name: "studyCredits", label: "Study credits (1–50)", type: "number", initial: "1" },
            { name: "maxParticipantsPerStudy", label: "People per study (1–20)", type: "number", initial: "5" },
            { name: "expiresAt", label: "Expires (optional)", type: "date", initial: "" },
          ]}
        />
      )}

      <Card>
        <CardHeader title="Access and credits" description={`${c.creditsAvailable} study credits available`} />
        <div className="space-y-2">
          {d.grants.length === 0 && <p className="text-sm text-ink-muted">No grants yet.</p>}
          {d.grants.map((g) => (
            <GrantRow key={g.id} clientId={c.id} g={g} />
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Payments" description="Test payments are sandbox orders and never count as revenue." />
        {d.orders.length === 0 ? (
          <p className="text-sm text-ink-muted">No orders.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {d.orders.map((o) => (
              <li key={o.id} className="flex flex-wrap gap-3">
                <span>
                  {(o.amountMinor / 100).toFixed(0)} {o.currency}
                </span>
                <Pill tone={o.environment === "live" ? "accent" : "neutral"}>{o.environment === "live" ? "Live" : "Test"}</Pill>
                <span>{o.status}</span>
                <span className="text-ink-muted">{formatDateTime(o.createdAt)}</span>
                <span className="font-mono text-xs text-ink-muted">{o.reference}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Websites" />
        {d.websites.length === 0 ? (
          <p className="text-sm text-ink-muted">No websites.</p>
        ) : (
          <KeyValue
            items={d.websites.map((w) => ({
              label: w.name,
              value: (
                <span>
                  {w.websiteUrl} · {w.integrationStatus}
                  {w.lastSdkVersion && ` · SDK ${w.lastSdkVersion}`}
                  {w.lastIssue && ` · last issue: ${w.lastIssue} (${formatDateTime(w.lastIssueAt)})`}
                </span>
              ),
            }))}
          />
        )}
      </Card>

      <Card>
        <CardHeader title="Tests" />
        <div className="space-y-4">
          {d.studies.length === 0 && <p className="text-sm text-ink-muted">No tests.</p>}
          {d.studies.map((s) => (
            <StudyBlock key={s.id} clientId={c.id} s={s} />
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Reports" />
        {d.reports.length === 0 ? (
          <p className="text-sm text-ink-muted">No reports.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {d.reports.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3">
                <Link className="text-accent hover:underline" to={`/app/admin/clients/${c.id}/reports/${r.id}`}>
                  {r.title}
                </Link>
                <Pill tone={r.status === "failed" ? "danger" : "neutral"}>{r.status}</Pill>
                {r.failureReason && <span className="text-danger">{r.failureReason}</span>}
                <span className="text-ink-muted">{formatDateTime(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Audit" description="Admin actions about this client, newest first." />
        {d.audit.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing recorded yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {d.audit.map((a) => {
              const meta = (a.metadata ?? {}) as { reason?: string };
              return (
                <li key={a.id} className="flex flex-wrap gap-3">
                  <span className="text-ink-muted">{formatDateTime(a.createdAt)}</span>
                  <span>{a.actorEmail ?? a.actorType}</span>
                  <span className="font-mono text-xs">{a.action}</span>
                  {meta.reason && <span className="text-ink-muted">“{meta.reason}”</span>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function GrantRow({ clientId, g }: { clientId: string; g: AdminGrantDto }) {
  const [open, setOpen] = useState<"revoke" | "credits" | null>(null);
  const inactive = !!g.revokedAt || (!!g.expiresAt && Date.parse(g.expiresAt) <= Date.now());
  return (
    <div className="rounded-lg border border-line p-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <Pill>{g.source}</Pill>
        <span>
          {g.creditsUsed}/{g.studyCredits} credits used · up to {g.maxParticipantsPerStudy} people
        </span>
        <span className="text-ink-muted">{g.expiresAt ? `Expires ${formatDate(g.expiresAt)}` : "No expiry"}</span>
        {g.revokedAt && <Pill tone="danger">Revoked {formatDate(g.revokedAt)}</Pill>}
        {!inactive && (
          <span className="ml-auto flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setOpen(open === "credits" ? null : "credits")}>
              Add credits
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setOpen(open === "revoke" ? null : "revoke")}>
              Revoke
            </Button>
          </span>
        )}
      </div>
      {open === "credits" && (
        <ActionForm
          title="Add credits"
          path={`/api/admin/clients/${clientId}/grants/${g.id}/credits`}
          clientId={clientId}
          onDone={() => setOpen(null)}
          fields={[{ name: "credits", label: "Credits to add (1–50)", type: "number", initial: "1" }]}
        />
      )}
      {open === "revoke" && (
        <ActionForm title="Revoke this grant" path={`/api/admin/clients/${clientId}/grants/${g.id}/revoke`} clientId={clientId} onDone={() => setOpen(null)} fields={[]} />
      )}
    </div>
  );
}

function StudyBlock({ clientId, s }: { clientId: string; s: AdminStudyDto }) {
  const [showSessions, setShowSessions] = useState(false);
  const [open, setOpen] = useState<"extend" | "rerun" | null>(null);
  const sessions = useQuery({
    queryKey: ["admin-client-sessions", clientId, s.id],
    queryFn: () => api<{ sessions: SessionListItem[] }>(`/api/admin/clients/${clientId}/studies/${s.id}/sessions`),
    enabled: showSessions,
  });
  return (
    <div className="rounded-lg border border-line p-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium">{s.name}</span>
        <Pill>{s.status}</Pill>
        <span className="text-ink-muted">
          v{s.currentVersion} · {s.finishedAttempts}/{s.participantLimit} finished · {s.expiresAt ? `ends ${formatDate(s.expiresAt)}` : "no end date"}
        </span>
        {s.latestReport && (
          <Pill tone={s.latestReport.status === "failed" ? "danger" : "neutral"}>
            Report {s.latestReport.status}
            {s.latestReport.sessionsIncluded != null && ` · covers ${s.latestReport.sessionsIncluded}`}
          </Pill>
        )}
        <span className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => setShowSessions(!showSessions)}>
            {showSessions ? "Hide sessions" : "Sessions"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setOpen(open === "extend" ? null : "extend")}>
            Extend
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setOpen(open === "rerun" ? null : "rerun")}>
            Re-run report
          </Button>
        </span>
      </div>
      {open === "extend" && (
        <ActionForm
          title="Extend this test"
          path={`/api/admin/clients/${clientId}/studies/${s.id}/extend`}
          clientId={clientId}
          onDone={() => setOpen(null)}
          fields={[{ name: "expiresAt", label: "New end date (at most 30 days away)", type: "date", initial: "" }]}
        />
      )}
      {open === "rerun" && (
        <ActionForm title="Re-run the UX Director report" path={`/api/admin/clients/${clientId}/studies/${s.id}/rerun-report`} clientId={clientId} onDone={() => setOpen(null)} fields={[]} />
      )}
      {showSessions && (
        <div className="mt-3">
          {sessions.isLoading ? (
            <Spinner />
          ) : sessions.error ? (
            <ErrorState message={errorMessage(sessions.error)} />
          ) : sessions.data!.sessions.length === 0 ? (
            <p className="text-ink-muted">No sessions yet.</p>
          ) : (
            <ul className="space-y-1">
              {sessions.data!.sessions.map((x) => (
                <li key={x.id} className="flex gap-3">
                  <Link className="text-accent hover:underline" to={`/app/admin/clients/${clientId}/sessions/${x.id}`}>
                    {x.participantLabel}
                  </Link>
                  <span>{x.status}</span>
                  <span className="text-ink-muted">{formatDateTime(x.startedAt)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-ink-muted">Opening a session is recorded in the audit log.</p>
        </div>
      )}
    </div>
  );
}

interface FieldDef {
  name: string;
  label: string;
  type: "number" | "date";
  initial: string;
}

/** Every support action needs a written reason; the server records it with before/after values. */
function ActionForm({ title, path, clientId, fields, onDone }: { title: string; path: string; clientId: string; fields: FieldDef[]; onDone: () => void }) {
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(fields.map((f) => [f.name, f.initial])));
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { reason };
      for (const f of fields) {
        const v = values[f.name]?.trim();
        if (!v) continue;
        body[f.name] = f.type === "date" ? new Date(`${v}T23:59:00`).toISOString() : Number(v);
      }
      return post(path, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-client", clientId] });
      qc.invalidateQueries({ queryKey: ["admin-clients"] });
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  return (
    <Panel>
      <form onSubmit={submit} className="space-y-3">
        <h3 className="font-medium">{title}</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          {fields.map((f) => (
            <Field key={f.name} label={f.label}>
              {(p) => <Input {...p} type={f.type} value={values[f.name]} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />}
            </Field>
          ))}
        </div>
        <Field label="Reason (required, recorded in the audit log)">
          {(p) => <Textarea {...p} required maxLength={500} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        {m.error && <Alert tone="danger">{errorMessage(m.error)}</Alert>}
        <div className="flex gap-2">
          <Button type="submit" size="sm" loading={m.isPending} disabled={!reason.trim()}>
            Confirm
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function ViewAsForm({ clientId, onCancel }: { clientId: string; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: () => post("/api/admin/impersonation", { userId: clientId, reason }),
    // A full page load so every cached query is fetched again as the client.
    onSuccess: () => window.location.assign("/app"),
  });
  return (
    <Panel>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <h3 className="font-medium">View as client</h3>
        <p className="text-sm text-ink-muted">You’ll see the app exactly as this builder does for 30 minutes. Nothing can be changed, and the visit is recorded.</p>
        <Field label="Reason (required, recorded in the audit log)">
          {(p) => <Textarea {...p} required maxLength={500} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        {m.error && <Alert tone="danger">{errorMessage(m.error)}</Alert>}
        <div className="flex gap-2">
          <Button type="submit" size="sm" loading={m.isPending} disabled={!reason.trim()}>
            Start viewing
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="mt-3 rounded-lg border border-accent/40 bg-accent-soft/30 p-4">{children}</div>;
}
