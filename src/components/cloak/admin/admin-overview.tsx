import Link from "next/link";
import type { AdminOverview as AdminOverviewData, MetricCount } from "@/lib/cloak/server/admin-metrics";
import { cn } from "@/lib/utils";

/*
 * The overview panel's body. Server-rendered, presentational, no hooks and no
 * "use client" — which is the point: a read-only dashboard has no reason to
 * ship JavaScript to the browser, and the numbers a reader sees are the numbers
 * the server computed, with nothing to reconcile on the client.
 *
 * Two rendering decisions carry the module's rules into the UI:
 *
 *  - Every chart is a proportion of a total that is printed next to it. A bar
 *    without its denominator invites the reader to compare two panels that were
 *    never comparable.
 *  - There is no per-account row anywhere, not even a collapsed one. The
 *    absence is stated in the footer rather than left for the reader to notice,
 *    because "it is not in the UI" and "it was never queried" look identical
 *    from the outside and only one of them is true.
 */

const TIER_LABELS: Record<string, string> = {
  none: "No membership",
  private: "Private",
  reserve: "Reserve",
  private_circle: "Private circle",
  office: "Office",
  sovereign: "Sovereign",
};

const ORIGIN_LABELS: Record<string, string> = {
  direct_usdc: "USDC settlement",
  reserve_guest_pass: "Reserve invitation",
  founding_adviser: "Founding Adviser",
  bank_transfer: "Bank transfer",
  invoice: "Invoice",
  contract: "Contract",
  admin_grant: "Operator grant",
  purchase: "Legacy purchase",
  unattributed: "Unattributed",
};

/** Rotating fills for the categorical bars, in reading order. */
const TONES = [
  "bg-cloak-gold",
  "bg-cloak-success",
  "bg-cloak-warning",
  "bg-cloak-danger",
  "bg-cloak-text-muted",
] as const;

interface Segment {
  key: string;
  label: string;
  count: number;
  tone: string;
}

function humanize(key: string): string {
  const spaced = key.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const scaled = bytes / 1024 ** exponent;
  return `${scaled >= 10 || exponent === 0 ? Math.round(scaled) : scaled.toFixed(1)} ${units[exponent]}`;
}

function formatPercent(ratio: number | null): string {
  return ratio === null ? "—" : `${Math.round(ratio * 100)}%`;
}

function formatDuration(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${(hours / 24).toFixed(1)} days`;
}

function toSegments(
  rows: MetricCount[],
  labels: Record<string, string>,
  tones: readonly string[] = TONES
): Segment[] {
  return rows.map((row, index) => ({
    key: row.key,
    label: labels[row.key] ?? humanize(row.key),
    count: row.count,
    tone: tones[index % tones.length] ?? "bg-cloak-text-muted",
  }));
}

export function AdminOverview({ overview }: { overview: AdminOverviewData }) {
  const { accounts, membership, invites, storage, devices, sessions, push } = overview;

  const tierSegments = toSegments(membership.byTier, TIER_LABELS);
  const originSegments = toSegments(membership.byOrigin, ORIGIN_LABELS);

  const funnelSegments: Segment[] = [
    { key: "redeemed", label: "Redeemed", count: invites.redeemed, tone: "bg-cloak-success" },
    { key: "pending", label: "Pending", count: invites.pending, tone: "bg-cloak-text-muted" },
    { key: "expired", label: "Expired", count: invites.expired, tone: "bg-cloak-warning" },
    { key: "revoked", label: "Revoked", count: invites.revoked, tone: "bg-cloak-danger" },
  ];

  return (
    <main className="min-h-dvh bg-cloak-bg text-cloak-text">
      <div className="mx-auto max-w-6xl px-5 py-8 md:px-8">
        <header className="border-b border-cloak-border pb-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cloak-gold">
            Cloak Dagger · Operator
          </p>
          <div className="mt-2 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="cloak-display text-3xl font-medium">Overview</h1>
              <p className="mt-2 max-w-2xl text-sm text-cloak-text-secondary">
                Aggregate counts only. Nothing here identifies a person or a conversation — see the note at the
                foot of this page.
              </p>
            </div>
            <nav className="flex items-center gap-2 text-sm" aria-label="Admin sections">
              <Link
                href="/admin"
                aria-current="page"
                className="rounded-lg border border-cloak-gold/30 bg-cloak-gold-soft px-3 py-2 text-cloak-gold"
              >
                Overview
              </Link>
              <Link
                href="/admin/invitations"
                className="rounded-lg border border-cloak-border px-3 py-2 text-cloak-text-secondary hover:bg-cloak-surface"
              >
                Invitations
              </Link>
              <Link
                href="/admin"
                className="rounded-lg border border-cloak-border-strong px-3 py-2 text-cloak-text hover:bg-cloak-surface"
              >
                Refresh
              </Link>
            </nav>
          </div>
          <p className="mt-3 text-xs text-cloak-text-muted">
            Computed {new Date(overview.generatedAt).toUTCString()}
          </p>
        </header>

        {/* -------- the four headline numbers -------- */}

        <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Accounts"
            value={formatCount(accounts.counted)}
            detail={
              accounts.excluded > 0
                ? `${formatCount(accounts.excluded)} operator/fixture rows excluded`
                : "No operator rows to exclude"
            }
          />
          <MetricCard
            label="New, 30 days"
            value={formatCount(accounts.newLast30Days)}
            detail={`${formatCount(accounts.newLast7Days)} in the last 7 days`}
          />
          <MetricCard
            label="Invites pending"
            value={formatCount(invites.pending)}
            detail={`${formatPercent(invites.redemptionRate)} of ${formatCount(invites.created)} redeemed`}
          />
          <MetricCard
            label="Attachment storage"
            value={formatBytes(storage.bytes)}
            detail={
              storage.oldestBlobAgeDays === null
                ? "No attachments stored"
                : `Oldest ${storage.oldestBlobAgeDays} days · ${formatCount(storage.expiredBlobs)} past TTL`
            }
          />
        </section>

        {/* -------- who is in, and how they got in -------- */}

        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          <Panel
            title="Membership by tier"
            caption={`${formatCount(membership.withTier)} of ${formatCount(accounts.counted)} accounts hold a tier`}
          >
            <StackedBar
              segments={tierSegments}
              total={tierSegments.reduce((sum, segment) => sum + segment.count, 0)}
              emptyLabel="No accounts yet."
              ariaLabel={`Membership by tier across ${formatCount(membership.withTier)} entitled accounts and ${formatCount(membership.withoutTier)} without.`}
            />
          </Panel>

          <Panel
            title="Membership by origin"
            caption="How each entitlement was actually granted"
          >
            <StackedBar
              segments={originSegments}
              total={originSegments.reduce((sum, segment) => sum + segment.count, 0)}
              emptyLabel="No entitlements granted yet."
              ariaLabel="Membership by origin across entitled accounts."
            />
            <p className="mt-3 text-xs leading-relaxed text-cloak-text-muted">
              Every entitlement comes from payment or invite redemption. There is no operator grant path, so a
              non-zero &ldquo;Operator grant&rdquo; here would mean an origin was written by hand.
            </p>
          </Panel>
        </section>

        {/* -------- the invite funnel -------- */}

        <section className="mt-4">
          <Panel
            title="Adviser invite funnel"
            caption={`${formatCount(invites.created)} created · ${formatPercent(invites.redemptionRate)} redeemed · median ${formatDuration(invites.medianHoursToRedeem)} to redeem`}
          >
            <StackedBar
              segments={funnelSegments}
              total={invites.created}
              emptyLabel="No adviser invitations created yet."
              ariaLabel={`Invite funnel: ${formatCount(invites.redeemed)} redeemed, ${formatCount(invites.pending)} pending, ${formatCount(invites.expired)} expired, ${formatCount(invites.revoked)} revoked.`}
            />
            <div className="mt-3 grid gap-2 text-xs text-cloak-text-secondary sm:grid-cols-2">
              <p>
                Last 30 days: {formatCount(invites.createdLast30Days)} created,{" "}
                {formatCount(invites.redeemedLast30Days)} redeemed.
              </p>
              <p>
                Pending excludes invitations already past their expiry — those are counted as expired, since a
                stale pending row is only an unswept one.
              </p>
            </div>
          </Panel>
        </section>

        {/* -------- signup trend -------- */}

        <section className="mt-4">
          <Panel
            title="Signups, last 30 days"
            caption={`${formatCount(accounts.newLast30Days)} accounts created`}
          >
            <TrendBars trend={accounts.trend} />
          </Panel>
        </section>

        {/* -------- delivery and device health -------- */}

        <section className="mt-4">
          <Panel title="Reach and device health" caption="Whether an account can actually be reached">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <HealthStat
                label="Push-enabled accounts"
                value={formatCount(push.accounts)}
                detail={`${formatCount(push.subscriptions)} install subscriptions`}
              />
              <HealthStat
                label="Active devices"
                value={formatCount(devices.active)}
                detail={`${formatCount(devices.seenLast7Days)} seen in 7 days · ${formatCount(devices.revoked)} revoked`}
              />
              <HealthStat
                label="Active sessions"
                value={formatCount(sessions.active)}
                detail={
                  sessions.legacy > 0
                    ? `${formatCount(sessions.legacy)} pre-registry (no device binding)`
                    : "All sessions device-bound"
                }
              />
              <HealthStat
                label="Email verified"
                value={formatCount(accounts.emailVerified)}
                detail="Needed for invite email binding"
              />
            </div>
          </Panel>
        </section>

        {/* -------- what is not here -------- */}

        <section className="mt-4 rounded-lg border border-cloak-border bg-cloak-bg-elevated p-5">
          <h2 className="text-sm font-semibold">Deliberately absent</h2>
          <p className="mt-2 text-xs leading-relaxed text-cloak-text-secondary">
            Message bodies, conversation key material and attachment contents are ciphertext on the server, so no
            query could return them. The rest of this list is a choice: no &ldquo;who talks to whom&rdquo;, no
            per-account message counts, no per-account last-active, and no contact lists. The server holds the
            rows that would derive a social graph — which is exactly why it is not rendered.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-cloak-text-muted">
            This panel performs no actions. Entitlements come only from payment verification and invite
            redemption; removing an account is the account holder&rsquo;s decision, and removing someone from a
            circle is that circle owner&rsquo;s.
          </p>
        </section>
      </div>
    </main>
  );
}

/* ---------- parts ---------- */

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-cloak-border bg-cloak-bg-elevated p-4">
      <p className="text-xs text-cloak-text-secondary">{label}</p>
      <p className="cloak-display mt-1 text-2xl font-medium">{value}</p>
      <p className="mt-1 text-xs text-cloak-text-muted">{detail}</p>
    </div>
  );
}

function Panel({
  title,
  caption,
  children,
}: {
  title: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-cloak-border bg-cloak-bg-elevated p-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-cloak-text-muted">{caption}</p>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function StackedBar({
  segments,
  total,
  emptyLabel,
  ariaLabel,
}: {
  segments: Segment[];
  total: number;
  emptyLabel: string;
  ariaLabel: string;
}) {
  if (total <= 0) {
    return (
      <div>
        <div className="h-2.5 rounded-full bg-cloak-surface" />
        <p className="mt-3 text-xs text-cloak-text-muted">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div>
      <div
        className="flex h-2.5 overflow-hidden rounded-full bg-cloak-surface"
        role="img"
        aria-label={ariaLabel}
      >
        {segments
          .filter((segment) => segment.count > 0)
          .map((segment) => (
            <div
              key={segment.key}
              className={segment.tone}
              style={{ width: `${(segment.count / total) * 100}%` }}
              title={`${segment.label} · ${formatCount(segment.count)}`}
            />
          ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-cloak-text-secondary">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-center gap-2">
            <span className={cn("h-2.5 w-2.5 rounded-sm", segment.tone)} aria-hidden />
            <span>
              {segment.label} <span className="text-cloak-text">{formatCount(segment.count)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TrendBars({ trend }: { trend: { date: string; count: number }[] }) {
  const peak = trend.reduce((highest, entry) => Math.max(highest, entry.count), 0);

  return (
    <div>
      <div
        className="flex h-24 items-end gap-[3px]"
        role="img"
        aria-label={`Daily signups over the last ${trend.length} days, peaking at ${formatCount(peak)} in a day.`}
      >
        {trend.map((entry) => {
          const height = peak > 0 && entry.count > 0 ? Math.max(8, Math.round((entry.count / peak) * 100)) : 0;
          return (
            <div
              key={entry.date}
              title={`${entry.date} · ${formatCount(entry.count)}`}
              className={cn(
                "min-w-0 flex-1 rounded-sm",
                height === 0 ? "bg-cloak-border-strong" : "bg-cloak-gold"
              )}
              style={{ height: height === 0 ? "3px" : `${height}%` }}
            />
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-cloak-text-muted">
        <span>{trend[0]?.date ?? ""}</span>
        <span>peak {formatCount(peak)}/day</span>
        <span>{trend[trend.length - 1]?.date ?? ""}</span>
      </div>
    </div>
  );
}

function HealthStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-cloak-border bg-cloak-bg p-4">
      <p className="text-xs text-cloak-text-secondary">{label}</p>
      <p className="cloak-display mt-1 text-xl font-medium">{value}</p>
      <p className="mt-1 text-xs text-cloak-text-muted">{detail}</p>
    </div>
  );
}
