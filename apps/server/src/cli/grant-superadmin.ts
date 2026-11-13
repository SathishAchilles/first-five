/**
 * Superadmins are granted only from the server, never from the app:
 *   npm run admin:grant-superadmin -- --email you@example.com
 *   npm run admin:grant-superadmin -- --revoke --email someone@example.com
 *   npm run admin:grant-superadmin -- --list
 */
import { audit } from "../lib/audit";
import { arg, cliContext } from "./_ctx";

const ctx = cliContext();
const has = (flag: string) => process.argv.includes(`--${flag}`);

if (has("list")) {
  const supers = await ctx.db.user.findMany({ where: { role: "superadmin" }, select: { email: true, createdAt: true }, orderBy: { createdAt: "asc" } });
  if (supers.length === 0) console.log("No superadmins.");
  for (const s of supers) console.log(`${s.email}  (account created ${s.createdAt.toISOString().slice(0, 10)})`);
  await ctx.db.$disconnect();
  process.exit(0);
}

const email = arg("email")?.trim().toLowerCase();
if (!email) {
  console.error("Usage: npm run admin:grant-superadmin -- --email you@example.com [--revoke] | --list");
  process.exit(1);
}
const user = await ctx.db.user.findUnique({ where: { email } });
if (!user) {
  console.error(`No account found for ${email}. Sign up first.`);
  process.exit(1);
}
const revoke = has("revoke");
await ctx.db.user.update({ where: { id: user.id }, data: { role: revoke ? "account_admin" : "superadmin" } });
await audit(ctx.db, {
  actorType: "system",
  action: revoke ? "user.superadmin_revoked" : "user.superadmin_granted",
  resourceType: "user",
  resourceId: user.id,
});
console.log(revoke ? `${email} is now an account admin only.` : `${email} is now a superadmin.`);
await ctx.db.$disconnect();
