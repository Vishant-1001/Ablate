import type { ProxyEvent, TxReceipt } from '../types';
import {
  INVARIANT_META,
  Pill,
  StepCallout,
  checkTone,
  friendlyArgs,
  friendlyToolName,
  friendlyUndoStrategy,
} from './ui';

// Center pane: 6-stage step-by-step view of Ablate staging (Step 3), safety rules (Step 4),
// and automatic undo (Step 6), with inline explanation dialogue boxes attached to each section.

export default function ShadowPane({
  events,
  receipt,
  aegis,
  stage = 6,
  onSetStage,
}: {
  events: ProxyEvent[];
  receipt: TxReceipt | null;
  aegis: boolean;
  stage?: number;
  onSetStage?: (s: number) => void;
}) {
  const staged = events.filter((e) => e.type === 'SHADOW_WRITE');
  const checks = receipt?.invariant_checks ?? [];
  const comps = receipt?.compensations ?? [];
  const isFraudScenario = receipt?.status === 'ABORTED_IN_SHADOW';

  return (
    <section
      className={`flex min-h-0 flex-col rounded-xl border bg-white transition-all ${
        stage === 3 || stage === 4 ? 'border-2 border-[#1d4ed8] shadow-md' : 'border-line'
      }`}
    >
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
        {/* Section 1: Safe Staging Sandbox (Step 3) */}
        <div>
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
                  ? 'Bypassed (Ablate Protection is Turned Off)'
                  : stage < 3
                    ? 'Waiting for Step 3 to stage updates…'
                    : 'Ready to stage updates'}
              </div>
            )}
          </div>

          {/* Dialogue Box for Step 3 */}
          {stage === 3 && receipt && (
            <StepCallout
              step={3}
              title={aegis ? 'Holding Changes in Staging Sandbox' : 'Staging Sandbox Bypassed'}
              text={
                aegis
                  ? 'Ablate intercepts the AI’s updates and holds them inside an isolated staging copy. None of the three live company databases on the right have been touched yet.'
                  : 'Because Ablate Protection is turned off in this scenario, the staging sandbox is bypassed and the AI’s changes go straight toward your live databases.'
              }
              tone={aegis ? 'blue' : 'amber'}
              onPrev={onSetStage ? () => onSetStage(2) : undefined}
              onNext={onSetStage ? () => onSetStage(4) : undefined}
            />
          )}
        </div>

        {/* Section 2: Company Safety Rules (Step 4) */}
        <div>
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
                {!aegis ? 'Rules skipped (Ablate Off)' : 'Checks 5 company rules at Step 4…'}
              </div>
            )}
          </div>

          {/* Dialogue Box for Step 4 */}
          {stage === 4 && receipt && (
            <StepCallout
              step={4}
              title={
                !aegis
                  ? 'Safety Rules Skipped'
                  : isFraudScenario
                    ? 'Fraudulent Wire Caught by Safety Rules!'
                    : 'All 5 Company Rules Verified'
              }
              text={
                !aegis
                  ? 'With Ablate turned off, no safety rules are checked before modifying your live records.'
                  : isFraudScenario
                    ? 'Ablate catches three rule violations at once: the $12,000 wire exceeds the $5,000 limit, the bank IBAN is unapproved, and the request came from untrusted invoice text. Ablate blocks it right here!'
                    : 'Ablate checks all 5 company safety rules with zero AI guesswork. Every rule passes, so the updates are cleared to commit.'
              }
              tone={!aegis ? 'amber' : isFraudScenario ? 'red' : 'green'}
              onPrev={onSetStage ? () => onSetStage(3) : undefined}
              onNext={onSetStage ? () => onSetStage(5) : undefined}
            />
          )}
        </div>

        {/* Section 3: Automatic Rollback (Step 6) */}
        <div>
          <div
            className={`rounded-xl border p-3 transition-all duration-300 ${
              stage === 5
                ? 'border-[#f3d9a4] bg-[#fef7e6]/60'
                : stage === 6 && comps.length > 0
                  ? 'border-[#15803d] bg-[#f3faf5]/50 ring-1 ring-[#15803d]'
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

            {stage === 5 && !isFraudScenario ? (
              <div className="rounded-lg border border-[#f3d9a4] bg-[#fef7e6] px-3 py-2 text-[12px] font-semibold text-[#5c3700]">
                Billing failed at Step 5! Look at the right column to see the database impact…
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
            ) : stage >= 4 && isFraudScenario ? (
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
      </div>
    </section>
  );
}
