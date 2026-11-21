import type { StatePayload, TxReceipt } from '../types';
import { StepCallout } from './ui';

// Right pane: layman-clear visual cards of the 3 Live Company Systems (Orders, Warehouse, Billing)
// with inline Step 5 & Step 6 explanation dialogue boxes attached directly to the live databases.

export default function LiveStatePane({
  state,
  receipt,
  stage = 6,
  onSetStage,
}: {
  state: StatePayload | null;
  receipt: TxReceipt | null;
  preHashes?: Record<string, string> | null;
  inFlight?: boolean;
  stage?: number;
  onSetStage?: (s: number) => void;
}) {
  const s = stage;
  const status = receipt?.status;
  const isFraudScenario = status === 'ABORTED_IN_SHADOW';

  const isMidCommit = s === 5 && !isFraudScenario;
  const livePoQty = Number(state?.erp?.purchase_orders?.[0]?.qty ?? 500);
  const liveWmsRes = Number(state?.wms?.inventory?.[0]?.reserved ?? 500);
  const liveGlCount = state?.erp?.gl_entries?.length ?? 0;

  let displayPoQty = 500;
  let displayWmsRes = 500;
  let displayGl = '$0';
  let erpBadge = { text: 'In Sync (500)', cls: 'bg-[#e3f2e8] text-[#14532d]' };
  let wmsBadge = { text: 'In Sync (500)', cls: 'bg-[#e3f2e8] text-[#14532d]' };
  let billBadge = { text: 'Open ($50,000)', cls: 'bg-[#e3f2e8] text-[#14532d]' };

  if (s >= 1 && s <= 4) {
    displayPoQty = 500;
    displayWmsRes = 500;
    displayGl = '$0';
    if (s === 4 && isFraudScenario) {
      billBadge = { text: 'Wire Blocked ($0) ✓', cls: 'bg-[#e3f2e8] text-[#14532d]' };
    }
  } else if (isMidCommit) {
    displayPoQty = status === 'QUARANTINED_CONCURRENT_EDIT' ? 470 : 480;
    displayWmsRes = 480;
    displayGl = '$2,000 Posted';
    erpBadge = {
      text: status === 'QUARANTINED_CONCURRENT_EDIT' ? 'Manager Edited → 470' : 'Updated → 480 boxes',
      cls: 'bg-[#fbebc8] text-[#5c3700]',
    };
    wmsBadge = { text: 'Updated → 480 boxes', cls: 'bg-[#fbebc8] text-[#5c3700]' };
    billBadge = { text: 'FAILED (Invoice Locked)', cls: 'bg-danger text-white' };
  } else if (s >= 5 && isFraudScenario) {
    erpBadge = { text: 'Untouched (500) ✓', cls: 'bg-[#e3f2e8] text-[#14532d]' };
    wmsBadge = { text: 'Untouched (500) ✓', cls: 'bg-[#e3f2e8] text-[#14532d]' };
    billBadge = { text: 'Wire Blocked ($0) ✓', cls: 'bg-[#e3f2e8] text-[#14532d]' };
  } else if (s >= 6 && receipt) {
    displayPoQty = livePoQty;
    displayWmsRes = liveWmsRes;
    displayGl = liveGlCount > 0 ? '$2,000 Posted' : '$0 (Clean)';

    if (status === 'PARTIAL_CORRUPTION') {
      erpBadge = { text: 'Stuck at 480 ✕', cls: 'bg-danger text-white' };
      wmsBadge = { text: 'Stuck at 480 ✕', cls: 'bg-danger text-white' };
      billBadge = { text: 'Failed ($0 Credited)', cls: 'bg-danger text-white' };
    } else if (status === 'ROLLED_BACK_CLEANLY') {
      erpBadge = { text: 'Undone → 500 ✓', cls: 'bg-[#e3f2e8] text-[#14532d]' };
      wmsBadge = { text: 'Undone → 500 ✓', cls: 'bg-[#e3f2e8] text-[#14532d]' };
      billBadge = { text: 'Unchanged ✓', cls: 'bg-[#e3f2e8] text-[#14532d]' };
    } else if (status === 'QUARANTINED_CONCURRENT_EDIT') {
      erpBadge = { text: 'Manager Edit Kept (470) ✓', cls: 'bg-[#fbebc8] text-[#5c3700]' };
      wmsBadge = { text: 'Undone → 500 ✓', cls: 'bg-[#e3f2e8] text-[#14532d]' };
      billBadge = { text: 'Unchanged ✓', cls: 'bg-[#e3f2e8] text-[#14532d]' };
    }
  }

  return (
    <section
      className={`flex min-h-0 flex-col rounded-xl border bg-white transition-all ${
        stage === 5 || stage === 6 ? 'border-2 border-[#15803d] shadow-md' : 'border-line'
      }`}
    >
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[15px] font-bold">Live Company Databases</h2>
          <div className="text-[12px] text-muted">Watch the live box counts change across all 3 systems</div>
        </div>
        <span className="rounded bg-[#f3f4f6] px-2 py-0.5 text-[11px] font-semibold text-[#374151]">
          3 Live Systems
        </span>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3.5">
        {/* System 1: Orders / ERP */}
        <div
          className={`rounded-xl border p-3 transition-all duration-300 ${
            isMidCommit
              ? 'border-2 border-[#d97706] bg-[#fef7e6]'
              : status === 'PARTIAL_CORRUPTION' && s >= 6
                ? 'border-2 border-danger bg-[#fffbfa]'
                : s === 6 && status === 'ROLLED_BACK_CLEANLY'
                  ? 'border-2 border-[#15803d] bg-[#f3faf5]'
                  : 'border-line bg-white'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-bold text-ink">1. Orders System (ERP)</span>
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${erpBadge.cls}`}>{erpBadge.text}</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg bg-paper p-2 text-center">
            <div>
              <div className="text-[11px] text-muted">Order #</div>
              <div className="mt-0.5 text-[13px] font-bold text-ink">PO-1042</div>
            </div>
            <div>
              <div className="text-[11px] text-muted">Order Quantity</div>
              <div
                className={`mt-0.5 text-[15px] font-extrabold transition-all ${
                  displayPoQty === 500
                    ? 'text-[#15803d]'
                    : displayPoQty === 470
                      ? 'text-[#5c3700]'
                      : 'text-danger'
                }`}
              >
                {displayPoQty} boxes
              </div>
            </div>
            <div>
              <div className="text-[11px] text-muted">Ledger Entry</div>
              <div className="mt-0.5 text-[12px] font-bold text-ink">{displayGl}</div>
            </div>
          </div>
        </div>

        {/* System 2: Warehouse */}
        <div
          className={`rounded-xl border p-3 transition-all duration-300 ${
            isMidCommit
              ? 'border-2 border-[#d97706] bg-[#fef7e6]'
              : status === 'PARTIAL_CORRUPTION' && s >= 6
                ? 'border-2 border-danger bg-[#fffbfa]'
                : s === 6 && status === 'ROLLED_BACK_CLEANLY'
                  ? 'border-2 border-[#15803d] bg-[#f3faf5]'
                  : 'border-line bg-white'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-bold text-ink">2. Warehouse Inventory</span>
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${wmsBadge.cls}`}>{wmsBadge.text}</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg bg-paper p-2 text-center">
            <div>
              <div className="text-[11px] text-muted">Item</div>
              <div className="mt-0.5 text-[13px] font-bold text-ink">SKU-900</div>
            </div>
            <div>
              <div className="text-[11px] text-muted">Total Stock</div>
              <div className="mt-0.5 text-[13px] font-bold text-ink">1,000 boxes</div>
            </div>
            <div>
              <div className="text-[11px] text-muted">Reserved for Order</div>
              <div
                className={`mt-0.5 text-[15px] font-extrabold transition-all ${
                  displayWmsRes === 500 ? 'text-[#15803d]' : 'text-danger'
                }`}
              >
                {displayWmsRes} boxes
              </div>
            </div>
          </div>
        </div>

        {/* System 3: Billing */}
        <div
          className={`rounded-xl border p-3 transition-all duration-300 ${
            isMidCommit || (status === 'PARTIAL_CORRUPTION' && s >= 6)
              ? 'border-2 border-danger bg-[#fffbfa]'
              : 'border-line bg-white'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-bold text-ink">3. Billing &amp; Payments</span>
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${billBadge.cls}`}>
              {billBadge.text}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg bg-paper p-2 text-center">
            <div>
              <div className="text-[11px] text-muted">Invoice #</div>
              <div className="mt-0.5 text-[13px] font-bold text-ink">INV-88</div>
            </div>
            <div>
              <div className="text-[11px] text-muted">Invoice Total</div>
              <div className="mt-0.5 text-[13px] font-bold text-ink">$50,000</div>
            </div>
            <div>
              <div className="text-[11px] text-muted">Refund / Payout</div>
              <div className="mt-0.5 text-[13px] font-bold text-ink">$0 Issued</div>
            </div>
          </div>
        </div>

        {/* Dialogue Box for Step 5 */}
        {s === 5 && receipt && (
          <StepCallout
            step={5}
            title={isFraudScenario ? 'Databases Remain Untouched' : 'Billing Rejects the Refund Mid-Update!'}
            text={
              isFraudScenario
                ? 'Because Ablate already stopped the fraudulent $12,000 wire inside the sandbox at Step 4, zero changes are sent to your live databases.'
                : status === 'QUARANTINED_CONCURRENT_EDIT'
                  ? 'Orders and Warehouse updated, and a human manager simultaneously edited Order #1042 to 470 boxes. Then Billing failed because Invoice #88 is locked!'
                  : 'Look at the numbers above: Orders and Warehouse just dropped from 500 to 480 boxes, and then Billing failed because Invoice #88 is locked by a nightly batch!'
            }
            tone={isFraudScenario ? 'green' : 'amber'}
            onPrev={onSetStage ? () => onSetStage(4) : undefined}
            onNext={onSetStage ? () => onSetStage(6) : undefined}
          />
        )}

        {/* Dialogue Box for Step 6 */}
        {s === 6 && receipt && (
          <StepCallout
            step={6}
            title={
              status === 'PARTIAL_CORRUPTION'
                ? 'Permanent Data Corruption ($2,000 Mismatch)'
                : status === 'ROLLED_BACK_CLEANLY'
                  ? 'Automatic Rollback Restored All Systems to 500!'
                  : status === 'ABORTED_IN_SHADOW'
                    ? '100% Protected — Zero Database Changes'
                    : 'Human Manager Edit Preserved (470 Kept)!'
            }
            text={
              status === 'PARTIAL_CORRUPTION'
                ? 'Without Ablate, there is no undo. Orders and Warehouse stay permanently stuck at 480 boxes while Billing issued $0 refund—leaving your books out of sync.'
                : status === 'ROLLED_BACK_CLEANLY'
                  ? `Ablate automatically reversed the updates in ${receipt.rollback_ms?.toFixed(1) ?? '1.8'} ms. Look above: Orders and Warehouse flipped right back from 480 to 500 boxes!`
                  : status === 'ABORTED_IN_SHADOW'
                    ? 'All three company databases remain completely untouched at 500 boxes. The unauthorized $12,000 wire was stopped with zero impact.'
                    : 'Ablate automatically restored Warehouse back to 500 boxes, detected the human manager’s 470-box edit on Order #1042, and kept the manager’s edit instead of overwriting it.'
            }
            tone={status === 'PARTIAL_CORRUPTION' ? 'red' : 'green'}
            onPrev={onSetStage ? () => onSetStage(5) : undefined}
          />
        )}
      </div>
    </section>
  );
}
