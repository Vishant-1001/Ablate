import type { StatePayload, TxReceipt } from '../types';
import { short } from './ui';

// Right pane: the three live production databases, their SHA-256 state hashes
// against the pre-transaction snapshot, and the big verification badge.

type Row = Record<string, unknown>;

function Mini({ rows, cols }: { rows: Row[]; cols: string[] }) {
  if (!rows.length) return <div className="px-3 py-1.5 font-mono text-[11px] text-muted">empty</div>;
  return (
    <table className="w-full font-mono text-[11px]">
      <thead>
        <tr className="text-muted">
          {cols.map((c) => (
            <th key={c} className="px-3 py-1 text-left font-medium">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-line">
            {cols.map((c) => (
              <td key={c} className="px-3 py-1">
                {String(r[c])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function badge(receipt: TxReceipt | null, inFlight: boolean): { cls: string; title: string; sub: string } {
  if (inFlight) return { cls: 'bg-[#f3f4f6] text-[#374151]', title: 'TRANSACTION IN FLIGHT', sub: 'waiting for commit' };
  if (!receipt) return { cls: 'bg-[#f3f4f6] text-muted', title: 'IDLE', sub: 'run an act' };
  const diverged = Object.keys(receipt.pre_tx_hashes).filter((k) => receipt.pre_tx_hashes[k] !== receipt.post_tx_hashes[k]);
  switch (receipt.status) {
    case 'ROLLED_BACK_CLEANLY':
      return { cls: 'bg-[#15803d] text-white', title: 'PRE-TX HASH == POST-ROLLBACK HASH', sub: `100% restored across ERP, WMS, Billing · ${receipt.rollback_ms?.toFixed(1)} ms` };
    case 'ABORTED_IN_SHADOW':
      return { cls: 'bg-[#15803d] text-white', title: 'BLOCKED IN SHADOW · 0 LIVE WRITES', sub: 'pre-tx hash == post-tx hash on all 3 databases' };
    case 'ESCALATED_HITL':
      return { cls: 'bg-[#fbebc8] text-[#5c3700]', title: 'HELD FOR HUMAN APPROVAL', sub: 'over the dollar cap · nothing written' };
    case 'PARTIAL_CORRUPTION':
      return { cls: 'bg-danger text-white', title: 'PARTIAL CORRUPTION', sub: `hashes diverged: ${diverged.join(', ').toUpperCase()} · nothing undone` };
    case 'QUARANTINED_CONCURRENT_EDIT':
      return { cls: 'bg-[#fbebc8] text-[#5c3700]', title: 'QUARANTINED · HUMAN EDIT KEPT', sub: 'WMS + GL undone; PO not overwritten (3-way diff logged)' };
    default:
      return { cls: 'bg-[#e3f2e8] text-[#14532d]', title: 'COMMITTED', sub: 'all checks passed; flushed to live services' };
  }
}

export default function LiveStatePane({ state, receipt, preHashes, inFlight }: { state: StatePayload | null; receipt: TxReceipt | null; preHashes: Record<string, string> | null; inFlight: boolean }) {
  const b = badge(receipt, inFlight);
  const dbs: Array<{ key: 'erp' | 'wms' | 'billing'; name: string; tables: Array<[string, Row[], string[]]> }> = state
    ? [
        { key: 'erp', name: 'ERP', tables: [['purchase_orders', state.erp.purchase_orders as Row[], ['po_id', 'qty', 'unit_price', 'status', 'version']], ['gl_entries', state.erp.gl_entries as Row[], ['entry_id', 'debit', 'credit']]] },
        { key: 'wms', name: 'WMS', tables: [['inventory', state.wms.inventory as Row[], ['sku', 'on_hand', 'reserved', 'version']]] },
        { key: 'billing', name: 'Billing', tables: [['invoices', state.billing.invoices as Row[], ['invoice_id', 'amount_usd', 'status']], ['credit_notes', state.billing.credit_notes as Row[], ['credit_id', 'amount_usd', 'status']]] },
      ]
    : [];
  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-line bg-white">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-[15px] font-bold">Live production databases</h2>
        <span className="font-mono text-[11px] text-muted">SQLite × 3</span>
      </header>
      <div className={`mx-3 mt-3 rounded-lg px-4 py-3 ${b.cls}`}>
        <div className="text-[15px] font-bold tracking-[0.03em]">{b.title}</div>
        <div className="text-[12px] opacity-90">{b.sub}</div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {dbs.map((db) => {
          const now = state?.[db.key].hash;
          const pre = preHashes?.[db.key];
          const same = !pre || pre === now;
          return (
            <div key={db.key} className={`rounded-lg border ${same ? 'border-line' : 'border-[#f0d3cf]'}`}>
              <div className={`flex items-center justify-between px-3 py-2 ${same ? '' : 'bg-[#fffbfa]'}`}>
                <span className="text-[13px] font-semibold">{db.name}</span>
                <span className={`font-mono text-[11px] ${same ? 'text-[#14532d]' : 'text-danger'}`}>
                  {short(now, 10)} {pre ? (same ? '= pre-tx' : '≠ pre-tx') : ''}
                </span>
              </div>
              {db.tables.map(([t, rows, cols]) => (
                <div key={t} className="border-t border-line">
                  <div className="px-3 pt-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
                    {t} ({rows.length})
                  </div>
                  <Mini rows={rows} cols={cols} />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
