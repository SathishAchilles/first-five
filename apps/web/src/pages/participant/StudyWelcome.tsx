import type { AttemptState, PublicStudyInfo } from "@firstfive/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, ExternalLink, Flag, HelpCircle, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ParticipantLayout } from "../../components/layouts";
import { Alert, Button, Card, ErrorState, Spinner, buttonClass } from "../../components/ui";
import { api, errorMessage, post } from "../../lib/api";
import { formatMinutes } from "../../lib/format";

export function StudyWelcomePage() {
  const { studyId } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["public-study", studyId], queryFn: () => api<PublicStudyInfo>(`/api/public/studies/${studyId}`) });
  const [attempt, setAttempt] = useState<AttemptState | null>(null);
  const [consent, setConsent] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [alreadyOpen, setAlreadyOpen] = useState(false);

  useEffect(() => {
    if (q.data?.existingAttempt) setAttempt(q.data.existingAttempt);
  }, [q.data]);

  const start = useMutation({
    mutationFn: async () => {
      // Open the tab synchronously so browsers don't block it, then point it at the website.
      const tab = window.open("about:blank", "_blank");
      try {
        const a = await post<AttemptState>(`/api/public/studies/${studyId}/attempts`, { consent: true });
        if (a.launchUrl && tab) {
          tab.opener = null;
          tab.location.href = a.launchUrl;
        } else {
          tab?.close();
          if (a.launchUrl) setPopupBlocked(true);
          else if (a.status === "pending") setAlreadyOpen(true);
        }
        return a;
      } catch (err) {
        tab?.close();
        throw err;
      }
    },
    onSuccess: setAttempt,
  });

  const end = useMutation({
    mutationFn: (reason: "finished" | "gave_up" | "consent_withdrawn") => post<AttemptState>(`/api/public/studies/${studyId}/attempt/end`, { reason }),
    onSuccess: (a) => {
      setAttempt(a);
      qc.invalidateQueries({ queryKey: ["public-study", studyId] });
      if (a.feedbackUrl) window.location.assign(a.feedbackUrl);
    },
  });

  if (q.isLoading)
    return (
      <ParticipantLayout>
        <Spinner />
      </ParticipantLayout>
    );
  if (q.error)
    return (
      <ParticipantLayout>
        <ErrorState message={errorMessage(q.error)} />
      </ParticipantLayout>
    );
  const s = q.data!;

  if (attempt) {
    return (
      <ParticipantLayout>
        <AttemptPanel
          info={s}
          attempt={attempt}
          popupBlocked={popupBlocked}
          alreadyOpen={alreadyOpen}
          onEnd={(reason) => end.mutate(reason)}
          ending={end.isPending}
          error={end.error ? errorMessage(end.error) : null}
          onResume={() => start.mutate()}
          resuming={start.isPending}
        />
      </ParticipantLayout>
    );
  }

  if (s.status !== "open") {
    const copy: Record<string, { title: string; body: string }> = {
      full: { title: "This test is full", body: "It already has all the participants it needs. Thank you for your interest!" },
      closed: { title: "This test has closed", body: "Thanks for your interest — it's no longer accepting participants." },
      expired: { title: "This test has ended", body: "Thanks for your interest — it's no longer accepting participants." },
      paused: { title: "This test is paused", body: "Please check back a little later." },
      not_launched: { title: "This test isn't open yet", body: "Please check back later." },
    };
    const c = copy[s.status] ?? copy.closed!;
    return (
      <ParticipantLayout>
        <Card className="p-6 text-center sm:p-10">
          <h1 className="text-xl font-semibold">{c.title}</h1>
          <p className="mt-2 text-ink-muted">{c.body}</p>
        </Card>
      </ParticipantLayout>
    );
  }

  return (
    <ParticipantLayout>
      <Card className="p-6 sm:p-8">
        <div className="text-sm text-ink-muted">You've been invited to try {s.websiteName}</div>
        <h1 className="mt-4 text-sm font-semibold uppercase tracking-wide text-accent">Your task</h1>
        <p className="mt-2 text-2xl font-semibold leading-snug tracking-tight">{s.task}</p>
        <p className="mt-4 flex items-start gap-2 text-[15px] leading-relaxed text-ink-muted">
          <Clock className="mt-1 h-4 w-4 shrink-0" aria-hidden />
          You have up to {formatMinutes(s.timeLimitSeconds)}. Use the website as you normally would. If you get stuck, that's useful feedback too.
        </p>

        <div className="mt-6 rounded-lg border border-line bg-canvas p-4 text-sm leading-relaxed">
          <div className="flex items-center gap-2 font-medium">
            <ShieldCheck className="h-4 w-4 text-accent" aria-hidden /> What we'll record
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-soft">
            <li>The pages you visit and the buttons and links you click on {s.websiteName}, only while you're doing this task.</li>
            <li>We never record what you type into fields, passwords or payment details.</li>
            <li>Afterwards we'll ask three short questions. You can skip any of them.</li>
            <li>You're identified only as an anonymous participant number. You can withdraw at any time.</li>
            <li>The person who invited you sees your session. First Five staff may also view it to support them and check report quality.</li>
          </ul>
        </div>

        <label className="mt-5 flex cursor-pointer items-start gap-3 text-[15px]">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-accent" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>I agree to have my activity recorded for this task as described above.</span>
        </label>

        {start.error && (
          <Alert tone="danger" className="mt-4">
            {errorMessage(start.error)}
          </Alert>
        )}
        <Button size="lg" className="mt-6 w-full sm:w-auto" disabled={!consent} loading={start.isPending} onClick={() => start.mutate()}>
          Start test
        </Button>
        <p className="mt-3 text-sm text-ink-muted">The website opens in a new tab. Keep this tab open — you'll come back here when you're done.</p>
      </Card>
    </ParticipantLayout>
  );
}

function useCountdown(deadline: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = Math.max(0, new Date(deadline).getTime() - now);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return { ms, label: `${m}:${String(s).padStart(2, "0")}` };
}

function AttemptPanel({
  info,
  attempt,
  popupBlocked,
  alreadyOpen,
  onEnd,
  ending,
  error,
  onResume,
  resuming,
}: {
  info: PublicStudyInfo;
  attempt: AttemptState;
  popupBlocked: boolean;
  alreadyOpen: boolean;
  onEnd: (r: "finished" | "gave_up" | "consent_withdrawn") => void;
  ending: boolean;
  error: string | null;
  onResume: () => void;
  resuming: boolean;
}) {
  const countdown = useCountdown(attempt.deadlineAt);

  if (attempt.status === "invalid") {
    return (
      <Card className="p-6 text-center sm:p-10">
        <h1 className="text-xl font-semibold">Thanks for your time</h1>
        <p className="mt-2 text-ink-muted">This attempt has ended and won't be used.</p>
      </Card>
    );
  }

  if (attempt.status !== "pending") {
    if (attempt.feedbackStatus === "submitted" || attempt.feedbackStatus === "skipped") {
      return (
        <Card className="p-6 text-center sm:p-10">
          <CheckCircle2 className="mx-auto h-10 w-10 text-success" aria-hidden />
          <h1 className="mt-4 text-xl font-semibold">Thank you — you're all done.</h1>
          <p className="mt-2 text-ink-muted">Your feedback helps the team behind {info.websiteName} improve their product.</p>
        </Card>
      );
    }
    return (
      <Card className="p-6 text-center sm:p-10">
        <h1 className="text-xl font-semibold">Thanks for testing.</h1>
        {attempt.feedbackUrl ? (
          <>
            <p className="mt-2 text-ink-muted">We have three quick questions for you.</p>
            <a href={attempt.feedbackUrl} className={buttonClass("primary", "lg", "mt-6")}>
              Continue to feedback
            </a>
          </>
        ) : (
          <p className="mt-2 text-ink-muted">Your attempt has ended.</p>
        )}
      </Card>
    );
  }

  return (
    <Card className="p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Your test is in progress</h1>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-sm font-medium tabular-nums text-accent-ink" aria-live="off">
          <Clock className="h-4 w-4" aria-hidden /> {countdown.ms > 0 ? `${countdown.label} left` : "Time's up"}
        </span>
      </div>
      <div className="mt-5 rounded-lg border border-line bg-canvas p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-accent">Your task</div>
        <p className="mt-1 text-[15px] font-medium">{info.task}</p>
      </div>
      {(popupBlocked || attempt.launchUrl) && (
        <Alert tone="info" className="mt-4" title={popupBlocked ? "Your browser blocked the new tab" : undefined}>
          <a href={attempt.launchUrl ?? "#"} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-medium underline">
            Open {info.websiteName} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        </Alert>
      )}
      {alreadyOpen && (
        <Alert tone="info" className="mt-4">
          The website is already open in another tab. Switch back to it to continue the task.
        </Alert>
      )}
      <p className="mt-5 text-[15px] leading-relaxed text-ink-muted">When you've finished — or if you get stuck — come back to this tab and let us know.</p>
      {error && (
        <Alert tone="danger" className="mt-4">
          {error}
        </Alert>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        <Button icon={Flag} loading={ending} onClick={() => onEnd("finished")}>
          I've finished
        </Button>
        <Button variant="secondary" icon={HelpCircle} disabled={ending} onClick={() => onEnd("gave_up")}>
          I'm stuck
        </Button>
        {!attempt.launchUrl && (
          <Button variant="ghost" icon={ExternalLink} loading={resuming} onClick={onResume}>
            Reopen the website
          </Button>
        )}
      </div>
      <div className="mt-6 border-t border-line pt-4 text-sm">
        <button
          className="text-ink-muted underline hover:text-ink"
          onClick={() => window.confirm("Withdraw from this test? Your activity will be deleted.") && onEnd("consent_withdrawn")}
          disabled={ending}
        >
          Withdraw and delete my activity
        </button>
      </div>
      <p className="mt-4 text-xs text-ink-muted">
        <Link to="/" className="underline">
          About First Five
        </Link>
      </p>
    </Card>
  );
}
