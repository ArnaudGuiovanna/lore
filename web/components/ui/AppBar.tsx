import Link from "next/link";
import { seed } from "@/lib/config";
import { getSession } from "@/lib/auth/session";
import { UserMenu } from "@/components/auth/UserMenu";
import type { SurfaceRole } from "./RoleSwitcher";
import styles from "./AppBar.module.css";

// Display labels for the current-role chip. The role is derived from membership;
// each surface passes the one it represents.
const ROLE_LABEL: Record<SurfaceRole, string> = {
  learner: "Learner",
  trainer: "Trainer",
  admin: "Tenant Admin",
};

// The unified LECTURE top bar: wordmark, always-visible tenant scope chip, the
// current role label, and the authenticated user (with sign-out). The role is
// derived from membership and enforced by middleware. Sticky, quiet, responsive.
export async function AppBar({ role }: { role: SurfaceRole }) {
  const s = seed();
  const session = await getSession();
  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        <Link href="/" className={styles.wordmark} aria-label="LORE home">
          LORE.
        </Link>

        <span className={styles.scope} title="Every backend call is bearer-JWT scoped to this tenant.">
          <span className={styles.scopeKey}>tenant</span>
          <span>{s.tenantSlug}</span>
          <span className={styles.scopeSep}>·</span>
          <span>{s.cohortName}</span>
        </span>

        <span className={styles.spacer} />

        <span className={styles.role}>
          <span className="quiet">role</span>
          <span className={styles.roleName}>{ROLE_LABEL[role]}</span>
        </span>

        <UserMenu name={session?.name || ""} role={session?.role || ROLE_LABEL[role]} />
      </div>
    </header>
  );
}
