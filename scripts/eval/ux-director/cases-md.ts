/** Writes the human review doc for the eval cases: npx tsx scripts/eval/ux-director/cases-md.ts */
import { writeFileSync } from "node:fs";
import { CASES, type Step } from "./cases";

const step = (s: Step) => {
  const wait = s.waitMs ? ` (+${s.waitMs / 1000}s)` : "";
  if ("custom" in s) return `${s.custom}${s.props ? JSON.stringify(s.props) : ""} @${s.page}${wait}`;
  if ("click" in s) return `click "${s.label}" @${s.page}${wait}`;
  return `${s.page}${wait}`;
};

const out: string[] = ["# UX Director analysis eval: cases for review", "", `${CASES.length} synthetic studies, five participants each (A–E). Participant keys map to real session ids at run time.`, ""];
out.push("| id | tags | planted issues (attempts) | clean | must not |", "|---|---|---|---|---|");
for (const c of CASES) {
  const issues = c.answerKey.issues.map((i) => `${i.id} ${i.summary} (${i.attempts.join("")})`).join("; ") || "none";
  out.push(`| ${c.id} | ${c.tags.join(", ")} | ${issues} | ${c.answerKey.clean.join("") || "—"} | ${c.answerKey.mustNot.length} |`);
}
for (const c of CASES) {
  out.push("", `## ${c.id}`, "", `**Tests:** ${c.purpose}`, "", `**Task:** ${c.study.task} Start \`${c.study.startPath}\`, goal: reach \`${c.study.goalTarget}\`.`, "");
  out.push("| | goal | steps | ease | Q2 answer | Q3 answer |", "|---|---|---|---|---|---|");
  for (const p of c.participants) {
    const a = p.answers;
    out.push(`| ${p.key} | ${p.reachGoal ? "yes" : "no"} | ${p.steps.map(step).join(" → ").replace(/\|/g, "\\|")} | ${a?.ease ?? "skipped"} | ${a?.q2 ?? "—"} | ${a?.q3 || "—"} |`);
  }
  out.push("", "**Answer key**", "");
  for (const i of c.answerKey.issues) out.push(`- **${i.id} ${i.summary}** — attempts ${i.attempts.join(", ")}; routes ${i.routes.map((r) => `\`${r}\``).join(", ")}`, `  - Mechanism: ${i.mechanism}`, `  - Fix looks like: ${i.fix}`);
  if (!c.answerKey.issues.length) out.push("- No planted issues: any kept finding is a false finding.");
  if (c.answerKey.clean.length) out.push(`- Clean attempts (should support no finding): ${c.answerKey.clean.join(", ")}`);
  for (const m of c.answerKey.mustNot) out.push(`- Must not: ${m}`);
}
writeFileSync(".claude/hillclimb/ux-director-analysis/cases.md", out.join("\n") + "\n");
console.log(`wrote ${CASES.length} cases`);
