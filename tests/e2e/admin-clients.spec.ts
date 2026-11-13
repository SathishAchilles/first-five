import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test("admin reviews a client, views as them read-only, and stops", async ({ browser, baseURL }) => {
  // A builder with complimentary access, so their workspace (and its forms) open.
  const builderPage = await (await browser.newContext({ baseURL })).newPage();
  const builderEmail = await signUp(builderPage);

  // The superadmin signs up normally and is promoted, as the grant-superadmin CLI does.
  const page = await (await browser.newContext({ baseURL })).newPage();
  const adminEmail = await signUp(page);
  const db = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
  await db.user.update({ where: { email: adminEmail }, data: { role: "superadmin" } });
  await db.$disconnect();

  await page.goto("/app/admin/clients");
  await expect(page.getByRole("link", { name: "Clients" })).toBeVisible();
  await page.getByLabel("Search clients").fill(builderEmail);
  await expect(page.getByRole("link", { name: builderEmail })).toBeVisible();
  // Flag filter: the builder has access, so "No access" hides them; clearing it brings them back.
  await page.getByRole("button", { name: "No access" }).click();
  await expect(page.getByRole("link", { name: builderEmail })).toHaveCount(0);
  await page.getByRole("button", { name: "No access" }).click();
  await expect(page.getByRole("link", { name: builderEmail })).toBeVisible();
  await expect(page.getByRole("link", { name: adminEmail })).toHaveCount(0);

  await page.getByRole("link", { name: builderEmail }).click();
  await expect(page.getByRole("heading", { name: builderEmail })).toBeVisible();
  await expect(page.getByText("Access and credits")).toBeVisible();

  // A support action needs a reason, then shows up in the client's audit trail.
  await page.getByRole("button", { name: "Grant access" }).click();
  await expect(page.getByRole("button", { name: "Confirm" })).toBeDisabled();
  await page.getByLabel("Reason (required, recorded in the audit log)").fill("pilot extra credit");
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("admin.grant_created")).toBeVisible();
  await expect(page.getByText("“pilot extra credit”")).toBeVisible();

  // View as client: the banner names the client and every change is refused.
  await page.getByRole("button", { name: "View as client" }).click();
  await page.getByLabel("Reason (required, recorded in the audit log)").fill("e2e support check");
  await page.getByRole("button", { name: "Start viewing" }).click();
  await expect(page.getByRole("status").filter({ hasText: `Viewing as ${builderEmail}` })).toBeVisible();
  await page.goto("/app/settings");
  await expect(page.getByRole("status").filter({ hasText: "read-only" })).toBeVisible();
  await page.getByLabel("Name").fill("Changed by admin");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("This view is read-only.").first()).toBeVisible();

  // Stop returns to the client's page in the admin area, as the admin.
  await page.getByRole("button", { name: "Stop viewing" }).click();
  await expect(page).toHaveURL(/\/app\/admin\/clients\//);
  await expect(page.getByRole("status").filter({ hasText: "Viewing as" })).toHaveCount(0);
  await expect(page.getByText("admin.impersonation_stopped")).toBeVisible();

  const check = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
  expect((await check.user.findUniqueOrThrow({ where: { email: builderEmail } })).name).toBeNull();
  await check.$disconnect();
});
