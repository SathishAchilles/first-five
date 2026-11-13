import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { del, READ_ONLY_EVENT } from "../lib/api";
import { useAuth } from "../lib/auth";
import { buttonClass } from "./ui";
/** Shown on every page while an admin views the app as a client. */
export function ImpersonationBanner() {
  const { me } = useAuth();
  if (!me?.impersonation) return null;
  return <Banner clientEmail={me.impersonation.clientEmail} expiresAt={me.impersonation.expiresAt} />;
}

function Banner({ clientEmail, expiresAt }: { clientEmail: string; expiresAt: string }) {
  const [now, setNow] = useState(Date.now());
  const [blocked, setBlocked] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    const onBlocked = (e: Event) => setBlocked((e as CustomEvent<string>).detail);
    window.addEventListener(READ_ONLY_EVENT, onBlocked);
    return () => {
      clearInterval(t);
      window.removeEventListener(READ_ONLY_EVENT, onBlocked);
    };
  }, []);
  const left = Math.max(0, Date.parse(expiresAt) - now);
  const mins = Math.floor(left / 60000);
  const secs = Math.floor((left % 60000) / 1000);
  // Past the end the server has already handed back the admin's own session.
  useEffect(() => {
    if (left === 0) window.location.assign("/app/admin/clients");
  }, [left]);
  const stop = async () => {
    setStopping(true);
    try {
      const r = await del<{ clientId: string; restored: boolean }>("/api/admin/impersonation");
      window.location.assign(r.restored ? `/app/admin/clients/${r.clientId}` : "/login");
    } catch {
      window.location.assign("/app/admin/clients");
    }
  };
  return (
    <>
    {/* Keeps the end of every page clear of the pinned bar. */}
    <div aria-hidden className="h-16" />
    <div role="status" className="fixed inset-x-0 bottom-0 z-50 border-t border-amber-300 bg-amber-100 text-amber-950 shadow-lg">
      <div className="mx-auto flex max-w-content flex-wrap items-center gap-3 px-4 py-2 text-sm sm:px-6">
        <ShieldCheck className="h-4 w-4" aria-hidden />
        <span>
          Viewing as <strong>{clientEmail}</strong> · read-only · {mins}:{String(secs).padStart(2, "0")} left
        </span>
        {blocked && <span className="font-medium">{blocked}</span>}
        <button type="button" onClick={stop} disabled={stopping} className={buttonClass("secondary", "sm", "ml-auto")}>
          {stopping ? "Stopping…" : "Stop viewing"}
        </button>
      </div>
    </div>
    </>
  );
}
