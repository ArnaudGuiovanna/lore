import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getSession } from "@/lib/auth/session";
import { ensureUserAndMembership } from "@/lib/auth/lore";
import { getByEmail, upsertCredential, setMustChangePassword } from "@/lib/auth/store";
import { sendMail, inviteMessage } from "@/lib/email";
import { api, tpath } from "@/lib/api";
import { loadTenantContext } from "@/lib/tenant-context";

// Mass learner import (B-12/B-23). Body: { csv, cohortId?, sendEmails? }.
// CSV columns: name,email (header row optional, separator , or ;). Each row
// provisions LORE user + LEARNER membership + temp credential, then optionally
// enrolls into the cohort. Per-row outcomes are reported — one bad row never
// aborts the batch.
interface Body {
  csv?: string;
  cohortId?: string;
  sendEmails?: boolean;
}

export interface ImportRowResult {
  line: number;
  email: string;
  name: string;
  status: "created" | "exists" | "error";
  tempPassword?: string;
  enrolled?: boolean;
  emailed?: boolean;
  error?: string;
}

const MAX_ROWS = 500;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function tempPassword(): string {
  return randomBytes(9).toString("base64url").replace(/[-_]/g, "").slice(0, 12);
}

// Parse "name,email" or "email,name" rows; tolerate ; separators and a header.
function parseRows(csv: string): Array<{ line: number; name: string; email: string } | { line: number; error: string }> {
  const out: Array<{ line: number; name: string; email: string } | { line: number; error: string }> = [];
  const lines = csv.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    const cells = raw.split(/[;,]/).map((c) => c.trim().replace(/^"|"$/g, ""));
    if (i === 0 && cells.some((c) => /^(nom|name|e-?mail|courriel)$/i.test(c))) continue; // header
    const email = cells.find((c) => EMAIL_RE.test(c))?.toLowerCase();
    const name = cells.filter((c) => c && c.toLowerCase() !== email).join(" ").trim();
    if (!email) {
      out.push({ line: i + 1, error: "aucun e-mail valide sur cette ligne" });
      continue;
    }
    out.push({ line: i + 1, name: name || email.split("@")[0], email });
  }
  return out;
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  if (session.role !== "TENANT_ADMIN" && session.role !== "SUPER_ADMIN" && session.role !== "GESTIONNAIRE") {
    return NextResponse.json({ error: "réservé à un administrateur" }, { status: 403 });
  }
  const body = (await req.json()) as Body;
  const csv = (body.csv || "").trim();
  if (!csv) return NextResponse.json({ error: "csv requis (colonnes nom,email)" }, { status: 400 });

  const rows = parseRows(csv);
  if (rows.length === 0) return NextResponse.json({ error: "aucune ligne exploitable" }, { status: 400 });
  if (rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `import limité à ${MAX_ROWS} lignes par lot` }, { status: 400 });
  }

  const ctx = await loadTenantContext();
  const base = process.env.PUBLIC_APP_URL || "";
  const loginUrl = base ? new URL("/login", base).toString() : "/login";

  const results: ImportRowResult[] = [];
  for (const row of rows) {
    if ("error" in row) {
      results.push({ line: row.line, email: "", name: "", status: "error", error: row.error });
      continue;
    }
    try {
      if (await getByEmail(row.email)) {
        results.push({ line: row.line, email: row.email, name: row.name, status: "exists" });
        continue;
      }
      const provisioned = await ensureUserAndMembership(row.email, row.name, "LEARNER", session.tenantId);
      if (!provisioned.ok) {
        results.push({ line: row.line, email: row.email, name: row.name, status: "error", error: provisioned.error });
        continue;
      }
      const password = tempPassword();
      await upsertCredential({
        email: row.email,
        name: row.name,
        role: "LEARNER",
        userId: provisioned.userId,
        tenantId: session.tenantId,
        password,
      });
      await setMustChangePassword(row.email, true);

      let enrolled = false;
      if (body.cohortId) {
        const r = await api.post(tpath(`/cohorts/${encodeURIComponent(body.cohortId)}/enrollments`), {
          learner_id: provisioned.userId,
        });
        enrolled = r.ok;
      }
      let emailed = false;
      if (body.sendEmails) {
        const mail = await sendMail(
          inviteMessage({
            name: row.name,
            email: row.email,
            tempPassword: password,
            loginUrl,
            orgName: ctx.tenantName || ctx.tenantSlug,
          })
        );
        emailed = mail.ok;
      }
      results.push({
        line: row.line,
        email: row.email,
        name: row.name,
        status: "created",
        tempPassword: password,
        enrolled,
        emailed,
      });
    } catch (e) {
      results.push({
        line: row.line,
        email: row.email,
        name: row.name,
        status: "error",
        error: e instanceof Error ? e.message : "erreur inconnue",
      });
    }
  }

  const created = results.filter((r) => r.status === "created").length;
  return NextResponse.json(
    { total: results.length, created, existing: results.filter((r) => r.status === "exists").length, results },
    { status: 201 }
  );
}
