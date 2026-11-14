import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Alert, Button, Card, Field, Input, Textarea } from "../../../components/ui";
import { errorMessage, fieldErrors, post } from "../../../lib/api";
import { formatDateTime } from "../../../lib/format";

export interface SetPasswordLink {
  setPasswordUrl: string;
  expiresAt: string;
}

/** Shows a one-time set-password link once, with a copy button. */
export function SetPasswordLinkBox({ link, email }: { link: SetPasswordLink; email?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(link.setPasswordUrl);
    setCopied(true);
  };
  return (
    <Alert tone="success" title={email ? `Send this link to ${email}` : "Send this link to the client"}>
      <p className="break-all font-mono text-xs">{link.setPasswordUrl}</p>
      <p className="mt-1 text-xs">Works once, until {formatDateTime(link.expiresAt)}. It's shown only now.</p>
      <Button size="sm" variant="secondary" className="mt-2" onClick={copy}>
        {copied ? "Copied" : "Copy link"}
      </Button>
    </Alert>
  );
}

/** Creates a client account for someone who already has an invitation code; they choose their own password from the link. */
export function OnboardClientForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", company: "", email: "", invitationCode: "", reason: "" });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const m = useMutation({
    mutationFn: () => post<SetPasswordLink & { clientId: string }>("/api/admin/clients/onboard", { ...form, company: form.company || undefined }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-clients"] }),
  });
  const fields = m.error ? fieldErrors(m.error) : {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  return (
    <Card className="p-5">
      {m.data ? (
        <div className="space-y-3">
          <SetPasswordLinkBox link={m.data} email={form.email} />
          <Button size="sm" variant="ghost" onClick={onClose}>
            Done
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <h3 className="font-medium">Onboard a client with their invitation code</h3>
          <p className="text-sm text-ink-muted">Creates their account and applies the code. They choose their own password from the link you send them.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" error={fields.name}>
              {(p) => <Input {...p} required value={form.name} onChange={set("name")} />}
            </Field>
            <Field label="Company" optional error={fields.company}>
              {(p) => <Input {...p} value={form.company} onChange={set("company")} />}
            </Field>
            <Field label="Email" error={fields.email}>
              {(p) => <Input {...p} type="email" required value={form.email} onChange={set("email")} />}
            </Field>
            <Field label="Invitation code they were given" error={fields.invitationCode ?? fields.code}>
              {(p) => <Input {...p} required className="font-mono" value={form.invitationCode} onChange={set("invitationCode")} />}
            </Field>
          </div>
          <Field label="Reason (required, recorded in the audit log)" error={fields.reason}>
            {(p) => <Textarea {...p} required maxLength={500} rows={2} value={form.reason} onChange={set("reason")} />}
          </Field>
          {m.error && <Alert tone="danger">{errorMessage(m.error)}</Alert>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={m.isPending} disabled={!form.reason.trim()}>
              Create account
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
