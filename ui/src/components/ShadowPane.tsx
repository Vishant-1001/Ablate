import type { ProxyEvent, TxReceipt } from '../types';
import { INVARIANT_META, Pill, checkTone, friendlyArgs, friendlyToolName, friendlyUndoStrategy } from './ui';

// Center pane: 6-stage step-by-step view of Ablate staging (Stage 3), safety rules (Stage 4),
// mid-flight error detection (Stage 5), and automatic undo (Stage 6).

export default function ShadowPane({
  events,
  receipt,
  aegis,
  stage = 6,
}: {
  events: ProxyEvent[];
  receipt: TxReceipt | null;
  aegis: boolean;
  stage?: number;
}) {
  const staged = events.filter((e) => e.type === 'SHADOW_WRITE');
  const checks = receipt?.invariant_checks ?? [];
  const comps = receipt?.compensations ?? [];

  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-line bg-white">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[15px] font-bold">Ablate Safety &amp; Undo Engine</h2>
          <div className="text-[12px] text-muted">Verifies safety rules and automatically reverses failed updates</div>
        </div>
        <span
          className={`shrink-0 rounded-md px-2.5 py-1 text-[11px] font-bold ${
            aegis ? 'bg-[#e3f2e8] text-[#14532d]' : 'bg-danger text-white'
          }`}
        >
          {aegis ? 'ABLATE ON' : 'ABLATE OFF'}
        </span>
      </header>

      <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto p-3.5">
        {!aegis && stage >= 3 && (
          <div className="rounded-lg border border-[#f0d3cf] bg-[#fffbfa] px-3 py-2.5 text-[12px] text-danger">
            <span className="font-bold">Ablate is Turned Off:</span> Updates skipped the staging sandbox and modified
            live databases directly with no undo protection.
          </div>
        )}

        {/* Section 1: Safe Staging Sandbox (Revealed at Stage 3) */}
        <div
          className={`rounded-xl border p-3 transition-all duration-300 ${
            stage === 3 ? 'border-[#1d4ed8] bg-[#eef4ff]/40 ring-1 ring-[#1d4ed8]' : 'border-line bg-white'
          }`}
        >
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12px] font-bold text-ink">Step 3 · Safe Staging Sandbox</span>
            <span className="text-[11px] text-muted">Holds changes before touching live DBs</span>
          </div>
          {stage >= 3 && aegis && staged.length > 0 ? (
            <ul className="space-y-1">
              {staged.map((e, i) => {
                const rawTool = e.message.split(' ')[0];
                const args = ((e.data as Record<string, unknown>).args ?? {}) as Record<string, unknown>;
                return (
                  <li key={i} className="rounded-lg border border-line bg-paper px-2.5 py-1.5">
                    <div className="text-[12px] font-bold text-ink">{friendlyToolName(rawTool)}</div>
                    <div className="text-[11px] text-[#374151]">{friendlyArgs(rawTool, args)}</div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="rounded-lg border border-dashed border-line px-3 py-2 text-[12px] text-muted">
              {!aegis
                ? 'Bypassed (Ablate Off)'
                : stage < 3
                  ? 'Waiting for AI Assistant to propose updates…'
                  : 'Ready to stage updates'}
            </div>
          )}
        </div>

        {/* Section 2: Company Safety Rules (Revealed at Stage 4) */}
        <div
          className={`rounded-xl border p-3 transition-all duration-300 ${
            stage === 4 ? 'border-[#1d4ed8] bg-[#eef4ff]/40 ring-1 ring-[#1d4ed8]' : 'border-line bg-white'
          }`}
        >
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12px] font-bold text-ink">Step 4 · Company Safety Rules</span>
            <span className="text-[11px] text-muted">Zero AI Guesswork</span>
          </div>
          {stage >= 4 && checks.length > 0 ? (
            <ul className="divide-y divide-line rounded-lg border border-line bg-white">
              {checks.slice(0, 5).map((c, i) => {
                const key = c.name.startsWith('dry_run') ? 'dry_run' : c.name;
                const meta = INVARIANT_META[key];
                return (
                  <li key={i} className="flex items-center justify-between gap-2 px-3 py-1.5">
                    <span className="text-[12px] font-medium text-ink">{meta?.label ?? c.name}</span>
                    <Pill tone={checkTone(c.result)}>
                      {c.result === 'ESCALATE_HITL'
                        ? 'Over $5k Limit'
                        : c.result === 'FAIL'
                          ? 'Blocked ✕'
                          : c.result === 'PASS'
                            ? 'Passed ✓'
                            : 'Skipped'}
                    </Pill>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="rounded-lg border border-dashed border-line px-3 py-2 text-[12px] text-muted">
              {!aegis ? 'Rules skipped (Ablate Off)' : 'Checks 5 company rules after staging…'}
            </div>
          )}
        </div>

        {/* Section 3: Automatic Rollback (Stage 5 shows error, Stage 6 shows Undo) */}
        <div
          className={`rounded-xl border p-3 transition-all duration-300 ${
            stage === 5
              ? 'border-[#f3d9a4] bg-[#fef7e6]/60 ring-1 ring-[#f3d9a4]'
              : stage === 6 && comps.length > 0
                ? 'border-[#15803d] bg-[#f3faf5]/50'
                : 'border-line bg-white'
          }`}
        >
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12px] font-bold text-ink">Step 6 · Automatic Undo on Failure</span>
            {stage >= 6 && typeof receipt?.rollback_ms === 'number' && (
              <span className="rounded bg-[#e3f2e8] px-2 py-0.5 text-[11px] font-bold text-[#14532d]">
                Undone in {receipt.rollback_ms.toFixed(1)} ms
              </span>
            )}
          </div>

          {stage === 5 && receipt?.status !== 'ABORTED_IN_SHADOW' ? (
            <div className="rounded-lg border border-[#f3d9a4] bg-[#fef7e6] px-3 py-2.5 text-[12px] font-semibold text-[#5c3700]">
              Step 5: Billing rejected the $2,000 credit note (Invoice #88 locked)! Preparing rollback…
            </div>
          ) : stage >= 6 && comps.length > 0 ? (
            <ol className="space-y-1">
              {comps.map((c, i) => {
                const isQuarantined = c.status === 'QUARANTINED_CONCURRENT_EDIT';
                return (
                  <li
                    key={i}
                    className={`rounded-lg border px-3 py-1.5 text-[12px] ${
                      isQuarantined ? 'border-[#f3d9a4] bg-[#fef7e6]' : 'border-[#cce5d5] bg-[#f3faf5]'
                    }`}
                  >
                    <div className="flex items-center justify-between font-semibold">
                      <span className={isQuarantined ? 'text-[#5c3700]' : 'text-[#14532d]'}>
                        {isQuarantined
                          ? 'Manager’s 470-Box Edit Protected'
                          : `Undo ${i + 1}: ${friendlyUndoStrategy(String(c.strategy), String(c.tool ?? ''))}`}
                      </span>
                      <span className="text-[11px]">{isQuarantined ? 'Saved ✓' : 'Restored ✓'}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : stage >= 4 && receipt?.status === 'ABORTED_IN_SHADOW' ? (
            <div className="rounded-lg border border-[#cce5d5] bg-[#f3faf5] px-3 py-2 text-[12px] text-[#14532d]">
              <span className="font-bold">Stopped in Sandbox:</span> Fraudulent wire was blocked at Step 4 before
              touching any database.
            </div>
          ) : stage >= 6 && receipt?.status === 'PARTIAL_CORRUPTION' ? (
            <div className="rounded-lg border border-[#f0d3cf] bg-[#fffbfa] px-3 py-2 text-[12px] text-danger">
              <span className="font-bold">No Undo Available:</span> Orders and Warehouse stayed stuck at 480 boxes.
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-line px-3 py-2 text-[12px] text-muted">
              Stands by to undo partial changes if any system fails.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
