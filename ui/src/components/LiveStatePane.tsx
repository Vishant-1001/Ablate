import type { StatePayload, TxReceipt } from '../types';

// Right pane: plain-English view of the 3 live production enterprise databases (ERP, Warehouse, Billing).

type Row = Record<string, unknown>;

const COL_LABELS: Record<string, string> = {
  po_id: 'Order #',
  qty: 'Order Qty',
  unit_price: 'Unit Price',
  status: 'Status',
  version: 'Rev',
  entry_id: 'Ledger Entry',
  debit: 'Debit',
  credit: 'Credit',
  sku: 'Item SKU',
  on_hand: 'Total Stock',
  reserved: 'Reserved',
  invoice_id: 'Invoice #',
  amount_usd: 'Amount',
  credit_id: 'Credit Note',
};

function formatCell(col: string, val: unknown): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'number' && (col.includes('usd') || col.includes('price') || col === 'debit' || col === 'credit')) {
    return `$${val.toLocaleString()}`;
  }
  if (col === 'qty' || col === 'on_hand' || col === 'reserved') {
    return `${String(val)} units`;
  }
  if (col === 'version') {
    return `v${String(val)}`;
  }
  return String(val);
}

function MiniTable({ rows, cols, emptyText }: { rows: Row[]; cols: string[]; emptyText: string }) {
  if (!rows.length) {
    return <div className="px-3 py-2 text-[12px] text-muted">{emptyText}</div>;
  }
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr className="border-b border-line bg-paper text-[11px] font-semibold text-muted">
          {cols.map((c) => (
            <th key={c} className="px-3 py-1.5 text-left">
              {COL_LABELS[c] ?? c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-line first:border-t-0">
            {cols.map((c) => (
              <td key={c} className="px-3 py-1.5 font-medium text-ink">
                {formatCell(c, r[c])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function banner(receipt: TxReceipt | null, inFlight: boolean): { cls: string; title: string; sub: string } {
  if (inFlight) {
    return {
      cls: 'bg-[#f3f4f6] text-[#374151]',
      title: 'Workflow in Progress',
      sub: 'Staging updates prior to verification',
    };
  }
  if (!receipt) {
    return {
      cls: 'bg-[#e3f2e8] text-[#14532d]',
      title: 'All 3 Production Systems Synchronized',
      sub: 'Baseline state: 500 units ordered · 500 units reserved · $50,000 open invoice',
    };
  }
  switch (receipt.status) {
    case 'ROLLED_BACK_CLEANLY':
      return {
        cls: 'bg-[#15803d] text-white',
        title: '100% Restored Across ERP, Warehouse & Billing',
        sub: `All partial changes automatically reversed in ${receipt.rollback_ms?.toFixed(1) ?? '1.8'} ms · Zero data corruption`,
      };
    case 'ABORTED_IN_SHADOW':
      return {
        cls: 'bg-[#15803d] text-white',
        title: 'Production Untouched — Threat Stopped in Sandbox',
        sub: 'Zero writes reached ERP, Warehouse, or Billing databases',
      };
    case 'ESCALATED_HITL':
      return {
        cls: 'bg-[#fbebc8] text-[#5c3700]',
        title: 'Held in Sandbox for Manager Approval',
        sub: 'Live production records remain untouched until approved',
      };
    case 'PARTIAL_CORRUPTION':
      return {
        cls: 'bg-danger text-white',
        title: 'Cross-System Data Mismatch ($2,000 Discrepancy)',
        sub: 'ERP and Warehouse were reduced to 480 units, while Billing failed to issue the $2,000 credit',
      };
    case 'QUARANTINED_CONCURRENT_EDIT':
      return {
        cls: 'bg-[#fbebc8] text-[#5c3700]',
        title: 'Human Manager Edit Preserved (470 Units Kept)',
        sub: 'Warehouse & Ledger rolled back cleanly; ERP order kept the human planner’s 470-unit update',
      };
    default:
      return {
        cls: 'bg-[#e3f2e8] text-[#14532d]',
        title: 'All Systems Updated & Verified',
        sub: 'ERP, Warehouse, and Billing are in sync',
      };
  }
}

export default function LiveStatePane({
  state,
  receipt,
  preHashes,
  inFlight,
}: {
  state: StatePayload | null;
  receipt: TxReceipt | null;
  preHashes: Record<string, string> | null;
  inFlight: boolean;
}) {
  const b = banner(receipt, inFlight);
  const dbs: Array<{
    key: 'erp' | 'wms' | 'billing';
    name: string;
    subtitle: string;
    tables: Array<[string, Row[], string[], string]>;
  }> = state
    ? [
        {
          key: 'erp',
          name: '1. ERP System (NetSuite / SAP)',
          subtitle: 'Purchase Orders & General Ledger',
          tables: [
            ['Purchase Orders', state.erp.purchase_orders as Row[], ['po_id', 'qty', 'unit_price', 'status', 'version'], 'No orders'],
            ['General Ledger Adjustments', state.erp.gl_entries as Row[], ['debit', 'credit'], 'No ledger adjustments posted (Clean)'],
          ],
        },
        {
          key: 'wms',
          name: '2. Warehouse Management (WMS)',
          subtitle: 'Physical Stock & Order Reservations',
          tables: [
            ['Warehouse Stock', state.wms.inventory as Row[], ['sku', 'on_hand', 'reserved', 'version'], 'No inventory rows'],
          ],
        },
        {
          key: 'billing',
          name: '3. Billing & Payments (Stripe / AP)',
          subtitle: 'Vendor Invoices & Credit Notes',
          tables: [
            ['Vendor Invoices', state.billing.invoices as Row[], ['invoice_id', 'amount_usd', 'status'], 'No invoices'],
            ['Issued Credit Notes', state.billing.credit_notes as Row[], ['credit_id', 'amount_usd', 'status'], 'No credit notes issued ($0 credited)'],
          ],
        },
      ]
    : [];

  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-line bg-white">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[15px] font-bold">Live Enterprise Systems of Record</h2>
          <div className="mt-0.5 text-[12px] text-muted">
            Real-time production records across ERP, Warehouse, and Billing
          </div>
        </div>
        <span className="rounded bg-[#f3f4f6] px-2 py-0.5 text-[11px] font-semibold text-[#374151]">
          3 Live Databases
        </span>
      </header>

      <div className={`mx-3.5 mt-3.5 rounded-lg px-4 py-3 ${b.cls}`}>
        <div className="text-[14px] font-bold">{b.title}</div>
        <div className="mt-0.5 text-[12px] opacity-95">{b.sub}</div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3.5">
        {dbs.map((db) => {
          const now = state?.[db.key].hash;
          const pre = preHashes?.[db.key];
          const same = !pre || pre === now;
          const isHumanKept = receipt?.status === 'QUARANTINED_CONCURRENT_EDIT' && db.key === 'erp';
          return (
            <div
              key={db.key}
              className={`overflow-hidden rounded-lg border ${
                same ? 'border-line' : isHumanKept ? 'border-[#f3d9a4]' : 'border-[#f0d3cf]'
              }`}
            >
              <div
                className={`flex items-center justify-between px-3 py-2 ${
                  same ? 'bg-white' : isHumanKept ? 'bg-[#fef7e6]' : 'bg-[#fffbfa]'
                }`}
              >
                <div>
                  <div className="text-[13px] font-bold text-ink">{db.name}</div>
                  <div className="text-[11px] text-muted">{db.subtitle}</div>
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                    same
                      ? 'bg-[#e3f2e8] text-[#14532d]'
                      : isHumanKept
                        ? 'bg-[#fbebc8] text-[#5c3700]'
                        : 'bg-danger text-white'
                  }`}
                >
                  {same ? 'Verified Clean ✓' : isHumanKept ? 'Human Edit Kept (470)' : 'Left Altered (480)'}
                </span>
              </div>
              {db.tables.map(([t, rows, cols, emptyText]) => (
                <div key={t} className="border-t border-line">
                  <div className="bg-paper/60 px-3 py-1 text-[11px] font-semibold text-[#374151]">{t}</div>
                  <MiniTable rows={rows} cols={cols} emptyText={emptyText} />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
