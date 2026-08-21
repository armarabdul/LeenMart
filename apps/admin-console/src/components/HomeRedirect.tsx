import { Link } from 'react-router-dom';
import { Card } from '@leen-mart/ui';
import { useAppSelector } from '@/app/hooks';
import { selectCurrentUser } from '@/shared/api/session.slice';

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  CATALOGUE_MODERATOR: 'Catalogue Moderator',
  FINANCE_ADMIN: 'Finance Admin',
  RISK_ANALYST: 'Risk Analyst',
  SUPPORT_AGENT: 'Support Agent',
};

interface DashboardLink {
  readonly to: string;
  readonly title: string;
  readonly description: string;
}

/**
 * `/` — the admin console's landing screen (Phase L, L3 "Dashboard/Home").
 *
 * Unlike `vendor-portal`'s own `HomeRedirect`, this has no per-account
 * branching to do: every admin role lands on the same screen, because
 * *what an administrator may do here* is a backend permission question
 * (`requirePermission`/`requireFullAccess`), not a client-side routing
 * decision — the same "frontend guards are UX only" principle L8 states.
 * Every link below is always shown; a role without the underlying
 * permission for a given screen still reaches it and sees the real 403
 * from the API, never a link silently withheld on a guess.
 *
 * Lists only the four screens actually implemented this phase — no
 * placeholder entries for refund/settlement/fraud/dispute/analytics
 * surfaces, none of which exist yet (L3, `03-business-decision-register.md`).
 */
const DASHBOARD_LINKS: readonly DashboardLink[] = [
  {
    to: '/kyc-review',
    title: 'KYC Review',
    description: 'Review vendor KYC submissions, approve or reject, and activate vendors.',
  },
  {
    to: '/product-moderation',
    title: 'Product Moderation',
    description: 'Review products submitted for listing and approve or reject them.',
  },
  {
    to: '/review-moderation',
    title: 'Review Moderation',
    description: 'Moderate customer product reviews awaiting a decision.',
  },
  {
    to: '/categories',
    title: 'Categories',
    description: 'Manage the category tree and per-category attributes.',
  },
];

export const HomeRedirect = (): JSX.Element => {
  const user = useAppSelector(selectCurrentUser);
  const roleLabel = user ? (ROLE_LABEL[user.role] ?? user.role) : '';

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-600">
          Signed in as {user?.email}
          {roleLabel && ` · ${roleLabel}`}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {DASHBOARD_LINKS.map((link) => (
          <Link key={link.to} to={link.to} className="block">
            <Card interactive className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-text">{link.title}</p>
              <p className="text-sm text-text-muted">{link.description}</p>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
};
