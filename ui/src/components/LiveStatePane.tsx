import type { StatePayload, TxReceipt } from '../types';

// Right pane: layman-clear visual cards of the 3 Live Company Systems (Orders, Warehouse, Billing)
// with animated stage transitions (500 -> 480 during mid-flight -> 500 after Ablate Undo).

export default function LiveStatePane({
  state,
  receipt,
  stage,
}: {
  state: StatePayload | null;
  receipt: TxReceipt | null;
  preHashes?: Record<string, string> | null;
  inFlight?: boolean;
  stage?: number; // 0=idle, 1=agent reading, 2=staging/rules, 3=mid-commit (480 applied, billing fails!), 4=final (rolled back to 500 or corrupted at 480)
}) {
  const s = stage ?? 4;
  const status = receipt?.status;

  // Compute displayed numbers at each animation stage so users literally see 500 -> 480 -> 500!
  const isMidCommit = s === 3 && status !== 'ABORTED_IN_SHADOW';
  const livePoQty = Number(state?.erp?.purchase_orders?.[0]?.qty ?? 500);
  const liveWmsRes = Number(state?.wms?.inventory?.[0]?.reserved ?? 500);
  const liveGlCount = state?.erp?.gl_entries?.length ?? 0;

  let displayPoQty = 500;
  let displayWmsRes = 500;
  let displayGl = '$0';
  let erpBadge = { text: 'In Sync (500)', cls: 'bg-[#e3f2e8] text-[#14532d]' };
  let wmsBadge = { text: 'In Sync (500)', cls: 'bg-[#e3f2e8] text-[#14532d]' };
  let billBadge = { text: 'Open ($50,000)', cls: 'bg-[#e3f2e8] text-[#14532d]' };

  if (s === 1 || s === 2) {
    // Before live flush: databases are untouched at 500
    displayPoQty = 500;
    displayWmsRes = 500;
    displayGl = '$0';
  } else if (isMidCommit) {
    // Stage 3: Orders & Warehouse just changed to 480, and Billing just threw HTTP 409!
    displayPoQty = status === 'QUARANTINED_CONCURRENT_EDIT' ? 470 : 480;
    displayWmsRes = 480;
    displayGl = '$2,000 Posted';
    erpBadge = { text: `Changed → ${displayPoQty} boxes`, cls: 'bg-[#fbebc8] text-[#5c3700]' };
    wmsBadge = { text: 'Changed → 480 boxes', cls: 'bg-[#fbebc8] text-[#5c3700]' };
    billBadge = { text: 'FAILED (Invoice Locked)', cls: 'bg-danger text-white' };
  } else if (s >= 4 && receipt) {
    displayPoQty = livePoQty;
    displayWmsRes = liveWmsRes;
    displayGl = liveGlCount > 0 ? '$2,000 Posted' : '$0 (Clean)';

    if (status === 'PARTIAL_CORRUPTION') {
      erpBadge = { text: 'Mismatched (480)', cls: 'bg-danger text-white' };
      wmsBadge = { text: 'Mismatched (480)', cls: 'bg-danger text-white' };
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

  // Top summary banner
  let topBanner = {
    cls: 'bg-[#f3f4f6] text-[#374151]',
    title: 'Ready — All 3 Company Systems at 500 Boxes',
    sub: 'Click any scenario above to watch the live updates',
  };
  if (s === 1) {
    topBanner = {
      cls: 'bg-[#eef4ff] text-[#1d4ed8]',
      title: 'Step 1 of 4 · AI Assistant Reading Order #1042…',
      sub: 'Live databases remain untouched',
    };
  } else if (s === 2) {
    topBanner =
      status === 'ABORTED_IN_SHADOW'
        ? {
            cls: 'bg-[#15803d] text-white',
            title: 'Threat Stopped in Sandbox — 0 Databases Touched',
            sub: 'Fraudulent $12,000 bank wire blocked before reaching Billing',
          }
        : {
            cls: 'bg-[#eef4ff] text-[#1d4ed8]',
            title: 'Step 2 of 4 · Ablate Verifying Company Safety Rules…',
            sub: 'Changes held safely in staging sandbox',
          };
  } else if (isMidCommit) {
    topBanner = {
      cls: 'bg-[#fbebc8] text-[#5c3700]',
      title: 'Step 3 of 4 · Orders & Warehouse Updated to 480 — Billing Failed!',
      sub: 'Invoice #88 is locked! Watch what happens next…',
    };
  } else if (s >= 4 && receipt) {
    if (status === 'PARTIAL_CORRUPTION') {
      topBanner = {
        cls: 'bg-danger text-white',
        title: 'DATA CORRUPTED — Systems Left Out of Sync ($2,000 Error)',
        sub: 'Orders & Warehouse dropped to 480 boxes, but Billing never issued the $2,000 refund',
      };
    } else if (status === 'ROLLED_BACK_CLEANLY') {
      topBanner = {
        cls: 'bg-[#15803d] text-white',
        title: '100% AUTO-RESTORED — All 3 Systems Back to 500 Boxes',
        sub: `Ablate automatically undid the Orders & Warehouse changes in ${receipt.rollback_ms?.toFixed(1) ?? '1.8'} ms`,
      };
    } else if (status === 'ABORTED_IN_SHADOW') {
      topBanner = {
        cls: 'bg-[#15803d] text-white',
        title: '100% PROTECTED — Fraudulent $12,000 Wire Blocked',
        sub: 'Zero live databases were modified',
      };
    } else if (status === 'QUARANTINED_CONCURRENT_EDIT') {
      topBanner = {
        cls: 'bg-[#fbebc8] text-[#5c3700]',
        title: 'MANAGER EDIT SAVED — 470 Boxes Kept, Warehouse Restored',
        sub: 'Ablate rolled back Warehouse to 500 without overwriting the human manager’s 470-box update',
      };
    }
  }

  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-line bg-white">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[15px] font-bold">Live Company Databases</h2>
          <div className="text-[12px] text-muted">Watch the live numbers change across all 3 systems</div>
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
              ? 'border-[#f3d9a4] bg-[#fef7e6]'
              : status === 'PARTIAL_CORRUPTION' && s >= 4
                ? 'border-[#f0d3cf] bg-[#fffbfa]'
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
              <div className="text-[11px] text-muted">Recorded Quantity</div>
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
              <div className="text-[11px] text-muted">Ledger Adjustment</div>
              <div className="mt-0.5 text-[13px] font-bold text-ink">{displayGl}</div>
            </div>
          </div>
        </div>

        {/* System 2: Warehouse */}
        <div
          className={`rounded-xl border p-3.5 transition-all duration-300 ${
            isMidCommit
              ? 'border-[#f3d9a4] bg-[#fef7e6]'
              : status === 'PARTIAL_CORRUPTION' && s >= 4
                ? 'border-[#f0d3cf] bg-[#fffbfa]'
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
              <div className="text-[11px] text-muted">Total Warehouse Stock</div>
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
            isMidCommit || (status === 'PARTIAL_CORRUPTION' && s >= 4)
              ? 'border-[#f0d3cf] bg-[#fffbfa]'
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
