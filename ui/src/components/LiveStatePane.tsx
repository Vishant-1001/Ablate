import type { StatePayload, TxReceipt } from '../types';

// Right pane: layman-clear visual cards of the 3 Live Company Systems (Orders, Warehouse, Billing)
// across 6 stages:
// Stage 1..4: Databases untouched at 500 boxes
// Stage 5: Orders & Warehouse drop to 480 boxes (or 470 manager edit), and Billing fails!
// Stage 6: Ablate Undo restores Orders & Warehouse back to 500 boxes (or without Ablate, stays stuck at 480!)

export default function LiveStatePane({
  state,
  receipt,
  stage = 6,
}: {
  state: StatePayload | null;
  receipt: TxReceipt | null;
  preHashes?: Record<string, string> | null;
  inFlight?: boolean;
  stage?: number;
}) {
  const s = stage;
  const status = receipt?.status;

  const isMidCommit = s === 5 && status !== 'ABORTED_IN_SHADOW';
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
    if (s === 4 && status === 'ABORTED_IN_SHADOW') {
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
    } else if (status === 'ABORTED_IN_SHADOW') {
      erpBadge = { text: 'Untouched (500) ✓', cls: 'bg-[#e3f2e8] text-[#14532d]' };
      wmsBadge = { text: 'Untouched (500) ✓', cls: 'bg-[#e3f2e8] text-[#14532d]' };
      billBadge = { text: 'Wire Blocked ($0) ✓', cls: 'bg-[#e3f2e8] text-[#14532d]' };
    } else if (status === 'QUARANTINED_CONCURRENT_EDIT') {
      erpBadge = { text: 'Manager Edit Kept (470) ✓', cls: 'bg-[#fbebc8] text-[#5c3700]' };
      wmsBadge = { text: 'Undone → 500 ✓', cls: 'bg-[#e3f2e8] text-[#14532d]' };
      billBadge = { text: 'Unchanged ✓', cls: 'bg-[#e3f2e8] text-[#14532d]' };
    }
  }

  let topBanner = {
    cls: 'bg-[#f3f4f6] text-[#374151]',
    title: 'Ready — All 3 Company Systems at 500 Boxes',
    sub: 'Click any scenario above to watch the step-by-step walkthrough',
  };
  if (s === 1) {
    topBanner = {
      cls: 'bg-[#eef4ff] text-[#1d4ed8]',
      title: 'Step 1 of 6 · AI Assistant Reading Current Records…',
      sub: 'All 3 databases are at 500 boxes',
    };
  } else if (s === 2) {
    topBanner = {
      cls: 'bg-[#eef4ff] text-[#1d4ed8]',
      title: 'Step 2 of 6 · AI Assistant Proposes Updates (500 → 480 Boxes)…',
      sub: 'Live databases are still untouched while updates are prepared',
    };
  } else if (s === 3) {
    topBanner = {
      cls: 'bg-[#eef4ff] text-[#1d4ed8]',
      title: 'Step 3 of 6 · Ablate Captures Changes in Safe Sandbox…',
      sub: '0 live databases modified',
    };
  } else if (s === 4) {
    topBanner =
      status === 'ABORTED_IN_SHADOW'
        ? {
            cls: 'bg-[#15803d] text-white',
            title: 'Step 4 of 6 · Fraudulent $12,000 Wire Blocked by Safety Rules!',
            sub: 'Stopped in sandbox — zero live databases were touched',
          }
        : {
            cls: 'bg-[#eef4ff] text-[#1d4ed8]',
            title: 'Step 4 of 6 · All 5 Company Safety Rules Passed ✓',
            sub: 'Now applying updates to live databases…',
          };
  } else if (isMidCommit) {
    topBanner = {
      cls: 'bg-[#fbebc8] text-[#5c3700]',
      title: 'Step 5 of 6 · Orders & Warehouse Changed to 480 — Billing Failed!',
      sub: 'Invoice #88 is locked! Look at Orders (480) and Warehouse (480) below…',
    };
  } else if (s >= 6 && receipt) {
    if (status === 'PARTIAL_CORRUPTION') {
      topBanner = {
        cls: 'bg-danger text-white',
        title: 'Step 6 of 6 · DATA CORRUPTED — Systems Left Out of Sync ($2,000 Error)',
        sub: 'Without Ablate, Orders & Warehouse stay stuck at 480 boxes while Billing gave $0 refund',
      };
    } else if (status === 'ROLLED_BACK_CLEANLY') {
      topBanner = {
        cls: 'bg-[#15803d] text-white',
        title: 'Step 6 of 6 · 100% AUTO-RESTORED — All Systems Back to 500 Boxes ✓',
        sub: `Ablate automatically reversed Orders & Warehouse from 480 → 500 boxes in ${receipt.rollback_ms?.toFixed(1) ?? '1.8'} ms`,
      };
    } else if (status === 'ABORTED_IN_SHADOW') {
      topBanner = {
        cls: 'bg-[#15803d] text-white',
        title: 'Step 6 of 6 · 100% PROTECTED — Fraudulent $12,000 Wire Blocked ✓',
        sub: 'Zero live databases were modified',
      };
    } else if (status === 'QUARANTINED_CONCURRENT_EDIT') {
      topBanner = {
        cls: 'bg-[#fbebc8] text-[#5c3700]',
        title: 'Step 6 of 6 · MANAGER EDIT SAVED — 470 Boxes Kept, Warehouse Restored ✓',
        sub: 'Ablate rolled back Warehouse to 500 without overwriting the manager’s 470-box update',
      };
    }
  }

  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-line bg-white">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[15px] font-bold">Live Company Databases</h2>
          <div className="text-[12px] text-muted">Watch the live box counts change across all 3 systems</div>
        </div>
        <span className="rounded bg-[#f3f4f6] px-2 py-0.5 text-[11px] font-semibold text-[#374151]">
          3 Live Systems
        </span>
      </header>

      <div className={`mx-3.5 mt-3.5 rounded-lg px-4 py-3 transition-all duration-300 ${topBanner.cls}`}>
        <div className="text-[14px] font-bold">{topBanner.title}</div>
        <div className="mt-0.5 text-[12px] opacity-95">{topBanner.sub}</div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3.5">
        {/* System 1: Orders / ERP */}
        <div
          className={`rounded-xl border p-3.5 transition-all duration-300 ${
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
          <div className="mt-2.5 grid grid-cols-3 gap-2 rounded-lg bg-paper p-2.5 text-center">
            <div>
              <div className="text-[11px] text-muted">Order #</div>
              <div className="mt-0.5 text-[14px] font-bold text-ink">PO-1042</div>
            </div>
            <div>
              <div className="text-[11px] text-muted">Order Quantity</div>
              <div
                className={`mt-0.5 text-[16px] font-extrabold transition-all ${
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
              <div className="mt-0.5 text-[13px] font-bold text-ink">{displayGl}</div>
            </div>
          </div>
        </div>

        {/* System 2: Warehouse */}
        <div
          className={`rounded-xl border p-3.5 transition-all duration-300 ${
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
          <div className="mt-2.5 grid grid-cols-3 gap-2 rounded-lg bg-paper p-2.5 text-center">
            <div>
              <div className="text-[11px] text-muted">Item</div>
              <div className="mt-0.5 text-[14px] font-bold text-ink">SKU-900</div>
            </div>
            <div>
              <div className="text-[11px] text-muted">Total Stock</div>
              <div className="mt-0.5 text-[14px] font-bold text-ink">1,000 boxes</div>
            </div>
            <div>
              <div className="text-[11px] text-muted">Reserved for Order</div>
              <div
                className={`mt-0.5 text-[16px] font-extrabold transition-all ${
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
          className={`rounded-xl border p-3.5 transition-all duration-300 ${
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
          <div className="mt-2.5 grid grid-cols-3 gap-2 rounded-lg bg-paper p-2.5 text-center">
            <div>
              <div className="text-[11px] text-muted">Invoice #</div>
              <div className="mt-0.5 text-[14px] font-bold text-ink">INV-88</div>
            </div>
            <div>
              <div className="text-[11px] text-muted">Invoice Total</div>
              <div className="mt-0.5 text-[14px] font-bold text-ink">$50,000</div>
            </div>
            <div>
              <div className="text-[11px] text-muted">Refund / Payout</div>
              <div className="mt-0.5 text-[14px] font-bold text-ink">$0 Issued</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
