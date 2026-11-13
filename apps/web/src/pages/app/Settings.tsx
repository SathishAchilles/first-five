import type { MeResponse } from "@firstfive/shared";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useState, type FormEvent } from "react";
import { Alert, Button, buttonClass, Card, CardHeader, Field, Input, KeyValue, PageHeader } from "../../components/ui";
import { errorMessage, patch, post } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatDate } from "../../lib/format";

const SOURCE_LABELS: Record<string, string> = {
  invitation_code: "Invitation code",
  payment: "Verified payment",
  admin: "Granted by First Five",
};

export function SettingsPage() {
  const { me, setMe } = useAuth();
  if (!me) return null;
  const e = me.entitlement;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Settings" />
      <AccountCard />
      <Card>
        <CardHeader title="Access and study credits" description="One credit is used when you launch a test. Viewing existing results never uses a credit." />
        <div className="space-y-4 p-5 sm:p-6">
          <KeyValue
            items={[
              { label: "Access", value: e.status === "active" ? e.planName : "No access yet" },
              { label: "Granted through", value: e.sources.map((s) => SOURCE_LABELS[s] ?? s).join(", ") || "—" },
              { label: "Study credits", value: `${e.creditsAvailable} unused of ${e.studyCredits}` },
              { label: "Websites", value: `${e.usage.projects} of ${e.maxProjects}` },
              { label: "Participants per test", value: e.maxParticipantsPerStudy ? `Up to ${e.maxParticipantsPerStudy}` : "—" },
              { label: "Access expires", value: e.expiresAt ? formatDate(e.expiresAt) : "No expiry" },
            ]}
          />
          <Link to="/access" className={buttonClass("secondary", "md")}>
            Get another study
          </Link>
        </div>
      </Card>
      <RedeemCard onRedeemed={setMe} />
    </div>
  );
}

function AccountCard() {
  const { me, setMe } = useAuth();
  const [name, setName] = useState(me?.user.name ?? "");
  const save = useMutation({ mutationFn: () => patch<MeResponse>("/api/account", { name }), onSuccess: setMe });
  return (
    <Card>
      <CardHeader title="Account" />
      <div className="space-y-4 p-5 sm:p-6">
        <KeyValue
          items={[
            { label: "Email", value: me?.user.email },
            { label: "Role", value: me?.user.role === "superadmin" ? "Superadmin (First Five)" : "Account admin" },
            { label: "Member since", value: formatDate(me?.user.createdAt) },
          ]}
        />
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            save.mutate();
          }}
        >
          <div className="min-w-[14rem] flex-1">
            <Field label="Name">{(p) => <Input {...p} maxLength={80} value={name} onChange={(ev) => setName(ev.target.value)} />}</Field>
          </div>
          <Button type="submit" variant="secondary" loading={save.isPending} disabled={name === (me?.user.name ?? "")}>
            Save
          </Button>
        </form>
        {save.isSuccess && <p className="text-sm text-success">Saved.</p>}
      </div>
    </Card>
  );
}

function RedeemCard({ onRedeemed }: { onRedeemed: (m: MeResponse) => void }) {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await post<MeResponse & { redemption: { planName: string } }>("/api/access/redeem", { code });
      onRedeemed({ user: res.user, entitlement: res.entitlement });
      setResult(`Code applied — you now have ${res.redemption.planName}.`);
      setCode("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  return (
    <Card>
      <CardHeader title="Have an invitation code?" description="Judges and pilot partners can unlock complimentary access here. A code isn't a password." />
      <form onSubmit={submit} className="space-y-3 p-5 sm:p-6" noValidate>
        {result && <Alert tone="success">{result}</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem] flex-1">
            <Field label="Invitation code">
              {(p) => <Input {...p} className="font-mono uppercase" placeholder="FF-XXXX-XXXX-XXXX-XXXX" autoComplete="off" spellCheck={false} value={code} onChange={(ev) => setCode(ev.target.value)} />}
            </Field>
          </div>
          <Button type="submit" loading={loading} disabled={code.trim().length < 8}>
            Redeem
          </Button>
        </div>
      </form>
    </Card>
  );
}
