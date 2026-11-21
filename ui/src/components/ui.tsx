import type { ReactNode } from 'react';
import type { InvariantCheck, TxReceipt } from '../types';

// Shared styling primitives and plain-English enterprise formatters (same theme, zero dev jargon).

export const INVARIANT_META: Record<string, { label: string; layer: string; desc: string }> = {
  ledger_balance: {
    label: 'Double-Entry Accounting Balance',
    layer: 'Policy 1',
    desc: 'Every general ledger entry must have equal debit and credit amounts',
  },
  inventory_non_negative: {
    label: 'Warehouse Stock Floor Protection',
    layer: 'Policy 2',
    desc: 'Available warehouse stock can never drop below zero',
  },
  dollar_cap: {
    label: 'Single-Transaction Approval Limit ($5,000)',
    layer: 'Policy 3',
    desc: 'Transactions above $5,000 are automatically held for manager sign-off',
  },
  iban_integrity: {
    label: 'Verified Vendor Bank Account (IBAN)',
    layer: 'Policy 4',
    desc: 'Payout destination must match the vendor’s approved master bank record',
  },
  provenance_taint: {
    label: 'Document & Prompt Manipulation Shield',
    layer: 'Policy 5',
    desc: 'External invoice notes cannot alter payout amounts or bank accounts',
  },
  dry_run: {
    label: 'Pre-Commit System Readiness Check',
    layer: 'Pre-Check',
    desc: 'Target systems confirm readiness before changes are committed',
  },
  aegis_disabled: {
    label: 'Protection Bypassed (Ablate Off)',
    layer: 'Unprotected',
    desc: 'Changes wrote directly to live systems without staging or rollback protection',
  },
};

export const VERDICT: Record<string, { label: string; block: string; pill: string; line: string; title: string }> = {
  PARTIAL_CORRUPTION: {
    label: 'DATA MISMATCH',
    block: 'bg-danger text-white',
    pill: 'bg-danger text-white',
    title: 'Unprotected Agent Run — Partial System Corruption',
    line: 'Billing rejected the credit note while ERP and Warehouse remained permanently altered ($2,000 discrepancy left behind).',
  },
  ABORTED_IN_SHADOW: {
    label: 'THREAT BLOCKED',
    block: 'bg-danger text-white',
    pill: 'bg-danger text-white',
    title: 'Unauthorized Payout Blocked Before Reaching Production',
    line: 'Ablate caught an unapproved $12,000 wire to an altered bank account in the staging sandbox. Zero live systems were touched.',
  },
  ESCALATED_HITL: {
    label: 'HELD FOR APPROVAL',
    block: 'bg-[#fbebc8] text-[#5c3700]',
    pill: 'bg-[#fbebc8] text-[#5c3700]',
    title: 'Transaction Held for Manager Approval',
    line: 'Total financial value exceeded the $5,000 automated approval limit. Held safely in staging.',
  },
  ROLLED_BACK_CLEANLY: {
    label: 'AUTO-RESTORED',
    block: 'bg-[#15803d] text-white',
    pill: 'bg-[#e3f2e8] text-[#14532d]',
    title: 'All 3 Enterprise Systems Automatically Restored',
    line: 'When Billing failed on step 4, Ablate automatically reversed the ERP and Warehouse updates in milliseconds.',
  },
  QUARANTINED_CONCURRENT_EDIT: {
    label: 'HUMAN EDIT SAVED',
    block: 'bg-[#fbebc8] text-[#5c3700]',
    pill: 'bg-[#fbebc8] text-[#5c3700]',
    title: 'Human Planner Edit Protected During Rollback',
    line: 'A human manager updated Purchase Order #1042 while the agent was working. Ablate rolled back Warehouse and Ledger without overwriting the manager’s edit.',
  },
  COMMITTED: {
    label: 'COMPLETED',
    block: 'bg-[#e3f2e8] text-[#14532d]',
    pill: 'bg-[#e3f2e8] text-[#14532d]',
    title: 'Multi-System Update Completed Safely',
    line: 'All business policies passed and changes were committed across ERP, Warehouse, and Billing.',
  },
};

export const verdictOf = (s?: string) => VERDICT[s ?? ''] ?? VERDICT.COMMITTED;

/** Plain-English title for any tool name */
/** Agent events name tools "erp_get_po"; MCP names them "erp.get_po". Map both to the MCP form. */
export function normalizeTool(tool: string): string {
  const t = tool.trim();
  if (t === 'commit_transaction') return 'ablate.commit_tx';
  return t.includes('.') ? t : t.replace(/^(erp|wms|billing)_/, '$1.');
}

export function friendlyToolName(rawTool: string): string {
  const tool = normalizeTool(rawTool);
  const map: Record<string, string> = {
    'erp.get_po': 'Read ERP Purchase Order',
    'erp.update_po_qty': 'Update ERP Purchase Order Quantity',
    'erp.post_gl_adjustment': 'Post General Ledger Accounting Entry',
    'erp.reverse_gl_adjustment': 'Reverse General Ledger Entry',
    'wms.get_inventory': 'Check Warehouse Stock Levels',
    'wms.adjust_reservation': 'Adjust Warehouse Reserved Stock',
    'billing.get_invoice': 'Read Vendor Billing Invoice',
    'billing.issue_credit_note': 'Issue Billing Credit Note',
    'billing.void_credit_note': 'Cancel Billing Credit Note',
    'billing.send_wire_payout': 'Initiate Outbound Bank Wire Transfer',
    'ablate.begin_tx': 'Start Protected Transaction Session',
    'ablate.commit_tx': 'Verify Rules & Commit Across All Systems',
    'ablate.abort_tx': 'Cancel Staged Transaction',
  };
  return map[tool] ?? tool.replace(/[._]/g, ' ');
}

/** Plain-English summary of tool arguments */
export function friendlyArgs(rawTool: string, args: Record<string, unknown> = {}): string {
  const tool = normalizeTool(rawTool);
  if (tool === 'erp.get_po') return `Order ${String(args.po_id ?? 'PO-1042')}`;
  if (tool === 'wms.get_inventory') return `Item ${String(args.sku ?? 'SKU-900')}`;
  if (tool === 'billing.get_invoice') return `Invoice ${String(args.invoice_id ?? 'INV-88')}`;
  if (tool === 'erp.update_po_qty') {
    return `Order ${String(args.po_id ?? 'PO-1042')} → Set quantity to ${String(args.new_qty ?? '')} units`;
  }
  if (tool === 'wms.adjust_reservation') {
    const d = Number(args.delta_qty ?? 0);
    return `Item ${String(args.sku ?? 'SKU-900')} → ${d < 0 ? `Release ${Math.abs(d)} reserved units` : `Restore +${d} reserved units`}`;
  }
  if (tool === 'erp.post_gl_adjustment') {
    return `Order ${String(args.po_id ?? 'PO-1042')} → $${Number(args.debit ?? 0).toLocaleString()} Debit / $${Number(args.credit ?? 0).toLocaleString()} Credit`;
  }
  if (tool === 'billing.issue_credit_note') {
    return `Invoice ${String(args.invoice_id ?? 'INV-88')} → Issue $${Number(args.amount_usd ?? 0).toLocaleString()} credit note`;
  }
  if (tool === 'billing.send_wire_payout') {
    return `Invoice ${String(args.invoice_id ?? 'INV-88')} → Wire $${Number(args.amount_usd ?? 0).toLocaleString()} to account ${String(args.vendor_iban ?? '')}`;
  }
  const entries = Object.entries(args).filter(([k]) => !['idempotency_key', 'tx_id', 'dry_run'].includes(k));
  if (!entries.length) return 'All staged systems';
  return entries.map(([k, v]) => `${k.replace(/_/g, ' ')}: ${String(v)}`).join(' · ');
}

/** Plain-English undo strategy name */
export function friendlyUndoStrategy(strategy?: string, tool?: string): string {
  if (strategy === 'VOID_BY_ID' || tool?.includes('gl_adjustment')) return 'Automatic Ledger Reversal';
  if (strategy === 'DELTA' || tool?.includes('adjust_reservation')) return 'Incremental Stock Restoration (+20 units)';
  if (strategy === 'ETAG_RESTORE' || tool?.includes('update_po_qty')) return 'Version-Checked Order Restoration';
  return 'Automatic Undo';
}

/** Human-friendly workflow title for a receipt (replaces raw tx_3439ca0e0650 headlines) */
export function friendlyReceiptTitle(r: TxReceipt | null, index?: number): string {
  if (!r) return 'No Workflow Selected';
  const labelNum = typeof index === 'number' && index >= 0 ? `Run #${index + 1} · ` : '';
  if (r.status === 'ABORTED_IN_SHADOW') return `${labelNum}Invoice #88 Wire Transfer Request (Blocked)`;
  if (r.status === 'PARTIAL_CORRUPTION') return `${labelNum}Purchase Order #1042 Shortage (Unprotected Failure)`;
  if (r.status === 'QUARANTINED_CONCURRENT_EDIT') return `${labelNum}Purchase Order #1042 Shortage (Human Edit Protected)`;
  if (r.status === 'ROLLED_BACK_CLEANLY') return `${labelNum}Purchase Order #1042 Shortage (Auto-Restored)`;
  return `${labelNum}Purchase Order #1042 Shortage Reconciliation`;
}

export function Pill({ tone, children }: { tone: 'red' | 'green' | 'amber' | 'slate' | 'gray'; children: ReactNode }) {
  const cls = {
    red: 'bg-danger text-white',
    green: 'bg-[#e3f2e8] text-[#14532d]',
    amber: 'bg-[#fbebc8] text-[#5c3700]',
    slate: 'bg-[#374151] text-white',
    gray: 'bg-[#f3f4f6] text-muted',
  }[tone];
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold tracking-[0.04em] ${cls}`}>
      {children}
    </span>
  );
}

export function Card({ title, aside, children, className = '' }: { title?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-xl border border-line bg-white ${className}`}>
      {title && (
        <div className="flex items-baseline justify-between gap-4 px-5 pt-4 pb-3">
          <h2 className="text-[16px] font-bold text-ink">{title}</h2>
          {aside && <div className="text-[12px] text-muted">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'red' }) {
  return (
    <div className="rounded-xl border border-line bg-white px-4 py-3">
      <div className="text-[12px] text-muted">{label}</div>
      <div className={`mt-1 text-[26px] font-bold leading-tight ${tone === 'red' ? 'text-danger' : 'text-ink'}`}>{value}</div>
    </div>
  );
}

export const short = (h?: string, n = 8) => (h ? (h.length > n ? `${h.slice(0, n)}…` : h) : '—');
export const fmtMs = (v?: number | null) => (typeof v === 'number' ? `${v.toFixed(1)} ms` : '—');
export const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function checkTone(r: string): 'green' | 'red' | 'amber' | 'gray' {
  if (r === 'PASS') return 'green';
  if (r === 'FAIL') return 'red';
  if (r === 'ESCALATE_HITL') return 'amber';
  return 'gray';
}

export function checkSummary(c: InvariantCheck): string {
  const d = c.detail || {};
  if (c.name === 'dollar_cap') {
    const over = (d.over as Array<{ tool: string; value: number }>) || [];
    return over.length
      ? `Requested $${over[0].value.toLocaleString()} exceeds the $${Number(d.max_auto_usd).toLocaleString()} automated limit`
      : `Within $${Number(d.max_auto_usd ?? 5000).toLocaleString()} automated approval limit`;
  }
  if (c.name === 'iban_integrity') {
    const v = (d.violations as Array<{ requested: string; master: string }>) || [];
    return v.length
      ? `Unapproved bank account (${v[0].requested}) does not match vendor record on file`
      : 'Matches approved vendor bank account on file';
  }
  if (c.name === 'provenance_taint') {
    const f = (d.findings as Array<{ tool: string; reason: string; field?: string }>) || [];
    return f.length
      ? 'Blocked attempt by external invoice text to trigger an unauthorized bank wire'
      : 'No external document text altered payment parameters';
  }
  if (c.name === 'ledger_balance') {
    const u = (d.unbalanced as unknown[]) || [];
    return u.length ? 'Accounting debit and credit amounts do not match' : 'Debits and credits balance to $0.00';
  }
  if (c.name === 'inventory_non_negative') {
    const v = (d.violations as unknown[]) || [];
    return v.length ? 'Order change would result in negative warehouse stock' : 'Warehouse stock remains positive (520 units available)';
  }
  if (c.name.startsWith('dry_run')) return c.result === 'PASS' ? 'Target system pre-check passed' : String(d.message ?? 'Rejected by target system');
  return '';
}

export function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export const PHASE_TONE: Record<string, string> = {
  AGENT: 'bg-[#eef2ff] text-[#3730a3]',
  STAGE: 'bg-[#f3f4f6] text-[#374151]',
  VALIDATE: 'bg-[#e3f2e8] text-[#14532d]',
  FLUSH: 'bg-[#e0f2fe] text-[#075985]',
  ROLLBACK: 'bg-[#fbebc8] text-[#5c3700]',
  RECEIPT: 'bg-ink text-white',
  LIVE: 'bg-[#fde8e6] text-danger',
  BEGIN: 'bg-[#f3f4f6] text-[#374151]',
};

const COL_LABELS: Record<string, string> = {
  po_id: 'Order #',
  vendor_id: 'Vendor',
  sku: 'Item SKU',
  qty: 'Quantity',
  unit_price: 'Unit Price ($)',
  status: 'Status',
  version: 'Revision',
  entry_id: 'Entry',
  debit: 'Debit ($)',
  credit: 'Credit ($)',
  memo: 'Description',
  on_hand: 'Total Stock',
  reserved: 'Reserved',
  invoice_id: 'Invoice #',
  amount_usd: 'Amount ($)',
  vendor_iban: 'Bank IBAN',
  credit_id: 'Credit Note #',
};

export function DataTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (!rows.length) return <div className="px-4 py-3 text-[13px] text-muted">No records added</div>;
  const cols = Object.keys(rows[0]);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[12px]">
        <thead>
          <tr className="border-b border-line text-[11px] font-semibold text-muted">
            {cols.map((c) => (
              <th key={c} className="px-3 py-2">
                {COL_LABELS[c] ?? c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              {cols.map((c) => (
                <td key={c} className="whitespace-nowrap px-3 py-2 text-ink">
                  {typeof r[c] === 'number' && (c.includes('usd') || c.includes('price') || c === 'debit' || c === 'credit')
                    ? `$${Number(r[c]).toLocaleString()}`
                    : String(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Guided dialogue box that appears directly attached to the active step in the demo */
export function StepCallout({
  step,
  title,
  text,
  tone = 'blue',
  onPrev,
  onNext,
}: {
  step: number;
  title: string;
  text: string;
  tone?: 'blue' | 'green' | 'amber' | 'red';
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const borderBg = {
    blue: 'border-[#1d4ed8] bg-[#111318] text-white',
    green: 'border-[#15803d] bg-[#111318] text-white',
    amber: 'border-[#d97706] bg-[#111318] text-white',
    red: 'border-danger bg-[#111318] text-white',
  }[tone];

  const badgeBg = {
    blue: 'bg-[#1d4ed8] text-white',
    green: 'bg-[#15803d] text-white',
    amber: 'bg-[#d97706] text-white',
    red: 'bg-danger text-white',
  }[tone];

  return (
    <div className={`relative mt-3 rounded-xl border-2 p-4 shadow-lg transition-all duration-300 ${borderBg}`}>
      {/* Pointer arrow pointing up to the active step element */}
      <div className="-top-2.5 left-6 absolute h-4 w-4 rotate-45 border-l-2 border-t-2 border-inherit bg-[#111318]" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`rounded-md px-2.5 py-1 text-[12px] font-bold uppercase tracking-[0.06em] ${badgeBg}`}>
          Step {step} of 6 · {title}
        </span>
        <div className="flex items-center gap-2">
          {onPrev && step > 1 && (
            <button
              onClick={onPrev}
              className="rounded-md border border-white/25 bg-white/10 px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-white/20"
            >
              ← Prev
            </button>
          )}
          {onNext && step < 6 && (
            <button
              onClick={onNext}
              className="rounded-md bg-[#1d4ed8] px-3 py-1 text-[12px] font-semibold text-white hover:bg-[#1e40af]"
            >
              Next Step →
            </button>
          )}
        </div>
      </div>
      <p className="mt-2.5 text-[15px] font-medium leading-relaxed text-white sm:text-[16px]">{text}</p>
    </div>
  );
}

