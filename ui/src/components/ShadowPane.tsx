import type { ProxyEvent, TxReceipt } from '../types';
import { INVARIANT_META, Pill, checkTone, friendlyArgs, friendlyToolName, friendlyUndoStrategy } from './ui';

// Center pane: plain-English view of Ablate staging, policy verification, and automatic rollback.

export default function ShadowPane({
  events,
  receipt,
  aegis,
}: {
  events: ProxyEvent[];
  receipt: TxReceipt | null;
  aegis: boolean;
}) {
  const staged = events.filter((e) => e.type === 'SHADOW_WRITE');
  const checks = receipt?.invariant_checks ?? [];
  const comps = receipt?.compensations ?? [];

  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-line bg-white">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[15px] font-bold">Ablate Safety &amp; Rollback Control Plane</h2>
          <div className="mt-0.5 text-[12px] text-muted">
            Stages multi-system writes, verifies company policies, and auto-reverts on failure
          </div>
        </div>
        <span
          className={`shrink-0 rounded-md px-2.5 py-1 text-[11px] font-bold ${
            aegis ? 'bg-[#e3f2e8] text-[#14532d]' : 'bg-danger text-white'
          }`}
        >
          {aegis ? 'PROTECTION ACTIVE' : 'PROTECTION OFF'}
        </span>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3.5">
        {!aegis && (
          <div className="rounded-lg border border-[#f0d3cf] bg-[#fffbfa] px-3.5 py-3 text-[13px] text-danger">
            <span className="font-bold">Ablate Protection is Disabled:</span> Agent changes bypassed the staging sandbox
            and modified live ERP and Warehouse records directly with no automatic rollback.
          </div>
        )}

        {/* 1. Staged Changes in Sandbox */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12px] font-bold uppercase tracking-[0.04em] text-ink">
              1. Staged Changes in Safe Sandbox ({staged.length})
            </span>
            <span className="text-[11px] text-muted">0 live systems touched during staging</span>
          </div>
          <ul className="space-y-1.5">
            {staged.map((e, i) => {
              const rawTool = e.message.split(' ')[0];
              const args = ((e.data as Record<string, unknown>).args ?? {}) as Record<string, unknown>;
              return (
                <li key={i} className="rounded-lg border border-line bg-paper px-3 py-2">
                  <div className="text-[13px] font-semibold text-ink">{friendlyToolName(rawTool)}</div>
                  <div className="text-[12px] text-[#374151]">{friendlyArgs(rawTool, args)}</div>
                </li>
              );
            })}
            {aegis && staged.length === 0 && (
              <li className="rounded-lg border border-dashed border-line px-3 py-3 text-[12px] text-muted">
                Waiting for staged updates…
              </li>
            )}
            {!aegis && (
              <li className="rounded-lg border border-dashed border-line px-3 py-2.5 text-[12px] text-muted">
                Sandbox bypassed — changes went straight to live systems.
              </li>
            )}
          </ul>
        </div>

        {/* 2. Automated Business Policy Gate */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12px] font-bold uppercase tracking-[0.04em] text-ink">
              2. Enterprise Policy Verification
            </span>
            <span className="text-[11px] text-muted">100% Deterministic · Zero AI Guesswork</span>
          </div>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {checks.map((c, i) => {
              const key = c.name.startsWith('dry_run') ? 'dry_run' : c.name;
              const meta = INVARIANT_META[key];
              return (
                <li key={i} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="text-[13px] font-medium text-ink">{meta?.label ?? c.name}</span>
                  <Pill tone={checkTone(c.result)}>
                    {c.result === 'ESCALATE_HITL'
                      ? 'Limit Exceeded'
                      : c.result === 'FAIL'
                        ? 'Blocked'
                        : c.result === 'PASS'
                          ? 'Verified ✓'
                          : 'Bypassed'}
                  </Pill>
                </li>
              );
            })}
            {checks.length === 0 && (
              <li className="px-3 py-2.5 text-[12px] text-muted">
                {aegis ? 'Policies will be verified prior to commit.' : 'Policy checks skipped (Ablate Off).'}
              </li>
            )}
          </ul>
        </div>

        {/* 3. Automatic Multi-System Undo / Commit Outcome */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12px] font-bold uppercase tracking-[0.04em] text-ink">
              3. Commit &amp; Automatic Rollback Execution
            </span>
            {typeof receipt?.rollback_ms === 'number' && (
              <span className="rounded bg-[#e3f2e8] px-2 py-0.5 text-[11px] font-bold text-[#14532d]">
                Restored in {receipt.rollback_ms.toFixed(1)} ms
              </span>
            )}
          </div>

          {comps.length > 0 ? (
            <ol className="space-y-1.5">
              {comps.map((c, i) => {
                const isQuarantined = c.status === 'QUARANTINED_CONCURRENT_EDIT';
                return (
                  <li
                    key={i}
                    className={`rounded-lg border px-3 py-2 text-[12px] ${
                      isQuarantined ? 'border-[#f3d9a4] bg-[#fef7e6]' : 'border-[#cce5d5] bg-[#f3faf5]'
                    }`}
                  >
                    <div className="flex items-center justify-between font-semibold">
                      <span className={isQuarantined ? 'text-[#5c3700]' : 'text-[#14532d]'}>
                        {isQuarantined
                          ? 'Human Planner Edit Protected (ERP Order #1042)'
                          : `Undo Step ${i + 1}: ${friendlyUndoStrategy(String(c.strategy), String(c.tool ?? ''))}`}
                      </span>
                      <span className="text-[11px]">
                        {isQuarantined ? 'Human Value Kept ✓' : 'Reverted Cleanly ✓'}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : receipt?.status === 'ABORTED_IN_SHADOW' ? (
            <div className="rounded-lg border border-[#cce5d5] bg-[#f3faf5] px-3 py-2.5 text-[12px] text-[#14532d]">
              <span className="font-bold">Blocked in Sandbox:</span> Unauthorized transaction was stopped before any
              live database was modified. No rollback required.
            </div>
          ) : receipt?.status === 'PARTIAL_CORRUPTION' ? (
            <div className="rounded-lg border border-[#f0d3cf] bg-[#fffbfa] px-3 py-2.5 text-[12px] text-danger">
              <span className="font-bold">No Rollback Performed:</span> Because Ablate was disabled, ERP and Warehouse
              changes remained permanently committed after Billing failed.
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-line px-3 py-2.5 text-[12px] text-muted">
              No rollback triggered yet.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
