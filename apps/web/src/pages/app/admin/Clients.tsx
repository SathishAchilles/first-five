import type { AdminClientFlag, AdminClientListResponse, AdminClientRow, AdminClientSort } from "@firstfive/shared";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, EmptyState, ErrorState, Input, Pill, Select, Spinner } from "../../../components/ui";
import { api, errorMessage } from "../../../lib/api";
import { formatDate, timeAgo } from "../../../lib/format";
import { OnboardClientForm } from "./Onboard";

export const FLAG_LABELS: Record<AdminClientFlag, string> = {
  no_website: "No website",
  not_connected: "Connection issue",
  no_attempts: "0 attempts after 48h",
  report_failed: "Report failed",
  payment_pending: "Payment awaiting check",
  no_access: "No access",
};

/** Flags shown in the list, detail and filter. "No website" is computed but not highlighted. */
export const SHOWN_FLAGS: AdminClientFlag[] = (Object.keys(FLAG_LABELS) as AdminClientFlag[]).filter((f) => f !== "no_website");
export const shownFlags = (flags: AdminClientFlag[]) => flags.filter((f) => SHOWN_FLAGS.includes(f));

export function FlagPill({ flag }: { flag: AdminClientFlag }) {
  return (
    <Pill tone={flag === "report_failed" || flag === "no_attempts" ? "danger" : "warning"} dot>
      {FLAG_LABELS[flag]}
    </Pill>
  );
}

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function AdminClientsPage() {
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const [flags, setFlags] = useState<AdminClientFlag[]>([]);
  const [access, setAccess] = useState<"any" | "active" | "none">("any");
  const [sort, setSort] = useState<AdminClientSort>("last_seen");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [onboarding, setOnboarding] = useState(false);
  useEffect(() => setPage(1), [q, flags, access, sort, dir]);

  const params = new URLSearchParams({ sort, dir, page: String(page), pageSize: "50", access });
  if (q) params.set("q", q);
  if (flags.length) params.set("flags", flags.join(","));
  const list = useQuery({ queryKey: ["admin-clients", params.toString()], queryFn: () => api<AdminClientListResponse>(`/api/admin/clients?${params}`) });

  const toggle = (f: AdminClientFlag) => setFlags((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));
  const sortBy = (s: AdminClientSort) => (s === sort ? setDir(dir === "desc" ? "asc" : "desc") : (setSort(s), setDir("desc")));
  const arrow = (s: AdminClientSort) => (s === sort ? (dir === "desc" ? " ↓" : " ↑") : "");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => setOnboarding(!onboarding)}>
          Onboard client
        </Button>
        <Input className="max-w-xs" placeholder="Search email or name" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search clients" />
        <Select className="w-auto" value={access} onChange={(e) => setAccess(e.target.value as typeof access)} aria-label="Access">
          <option value="any">Any access</option>
          <option value="active">Has access</option>
          <option value="none">No access</option>
        </Select>
      </div>
      {onboarding && <OnboardClientForm onClose={() => setOnboarding(false)} />}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by flag">
        {SHOWN_FLAGS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={flags.includes(f)}
            onClick={() => toggle(f)}
            className={clsx(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              flags.includes(f) ? "border-accent bg-accent-soft text-accent-ink" : "border-line text-ink-muted hover:text-ink",
            )}
          >
            {FLAG_LABELS[f]}
          </button>
        ))}
      </div>

      {list.isLoading ? (
        <Spinner />
      ) : list.error ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : list.data!.clients.length === 0 ? (
        <EmptyState title="No clients match" description="Clear a filter or the search to see more." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-4 py-3">Client</th>
                <th className="px-3 py-3">Access</th>
                <th className="px-3 py-3 text-right">Credits</th>
                <th className="px-3 py-3 text-right">Paid (live)</th>
                <th className="px-3 py-3 text-right">Websites</th>
                <th className="px-3 py-3 text-right">Tests</th>
                <th className="px-3 py-3 text-right">
                  <button type="button" onClick={() => sortBy("attempts")}>Attempts{arrow("attempts")}</button>
                </th>
                <th className="px-3 py-3">Report</th>
                <th className="px-3 py-3">
                  <button type="button" onClick={() => sortBy("signed_up")}>Signed up{arrow("signed_up")}</button>
                </th>
                <th className="px-3 py-3">
                  <button type="button" onClick={() => sortBy("last_seen")}>Last seen{arrow("last_seen")}</button>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data!.clients.map((c) => (
                <ClientRow key={c.id} c={c} />
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {list.data && list.data.total > list.data.pageSize && (
        <div className="flex items-center justify-between text-sm text-ink-muted">
          <span>
            Page {list.data.page} of {Math.ceil(list.data.total / list.data.pageSize)} · {list.data.total} clients
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="secondary" disabled={page * list.data.pageSize >= list.data.total} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ClientRow({ c }: { c: AdminClientRow }) {
  return (
    <tr className="border-b border-line last:border-0 align-top">
      <td className="px-4 py-3">
        <Link to={`/app/admin/clients/${c.id}`} className="font-medium text-accent hover:underline">
          {c.email}
        </Link>
        {c.name && <div className="text-xs text-ink-muted">{c.name}</div>}
        {c.waitlistJoinedAt && <div className="text-xs text-ink-muted">On waitlist since {formatDate(c.waitlistJoinedAt)}</div>}
        {c.pendingPasswordSetup && <div className="text-xs text-ink-muted">Onboarded · hasn't set a password yet</div>}
        {shownFlags(c.flags).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {shownFlags(c.flags).map((f) => (
              <FlagPill key={f} flag={f} />
            ))}
          </div>
        )}
      </td>
      <td className="px-3 py-3">{c.access === "active" ? "Active" : "None"}</td>
      <td className="px-3 py-3 text-right">{c.creditsAvailable}</td>
      <td className="px-3 py-3 text-right">
        {c.livePaidOrders}
        {c.testPaidOrders > 0 && <div className="text-xs text-ink-muted">{c.testPaidOrders} test</div>}
      </td>
      <td className="px-3 py-3 text-right">
        {c.connectedWebsites}/{c.websites}
      </td>
      <td className="px-3 py-3 text-right">{c.launchedStudies}</td>
      <td className="px-3 py-3 text-right">{c.finishedAttempts}</td>
      <td className="px-3 py-3">{c.latestReportStatus ?? "—"}</td>
      <td className="px-3 py-3 whitespace-nowrap">{formatDate(c.createdAt)}</td>
      <td className="px-3 py-3 whitespace-nowrap">{c.lastSeenAt ? timeAgo(c.lastSeenAt) : "Never"}</td>
    </tr>
  );
}
