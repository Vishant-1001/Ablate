import type { ReactNode } from 'react';
import type { InvariantCheck } from '../types';

// Shared styling primitives and helpers (light case-file design system).

export const INVARIANT_META: Record<string, { label: string; layer: string; desc: string }> = {
  ledger_balance: { label: 'Ledger balance', layer: 'L1', desc: 'Every GL entry: debit == credit' },
  inventory_non_negative: { label: 'Inventory non-negative', layer: 'L1', desc: 'on_hand − reserved ≥ 0' },
  dollar_cap: { label: 'Dollar cap', layer: 'L1', desc: 'Money moved ≤ max_auto_usd, else human approval' },
  iban_integrity: { label: 'IBAN integrity', layer: 'L1', desc: 'Payout IBAN matches vendor master data' },
  provenance_taint: { label: 'Provenance taint', layer: 'L2', desc: 'No money or IBAN field sourced from untrusted EDI text' },
  dry_run: { label: 'Native dry-run', layer: 'L3', desc: 'Live APIs accept the call with dry_run=true' },
};

// ---------- verdict styling (mockup: red BLOCK block, pill badges) ----------

export const VERDICT: Record<string, { label: string; block: string; pill: string; line: string }> = {
  PARTIAL_CORRUPTION: {
    label: 'CORRUPTED',
    block: 'bg-danger text-white',
    pill: 'bg-danger text-white',
    line: 'Downstream fault left ERP and WMS changed with nothing to undo them.',
  },
  ABORTED_IN_SHADOW: {
    label: 'BLOCKED',
    block: 'bg-danger text-white',
    pill: 'bg-danger text-white',
    line: 'Rejected by the invariant gate in the shadow twin. Zero live writes.',
  },
  ESCALATED_HITL: {
    label: 'ESCALATED',
    block: 'bg-[#fbebc8] text-[#5c3700]',
    pill: 'bg-[#fbebc8] text-[#5c3700]',
    line: 'Over the auto-approve dollar cap. Held for a human approver; nothing written.',
  },
  ROLLED_BACK_CLEANLY: {
    label: 'ROLLED BACK',
    block: 'bg-ink text-white',
    pill: 'bg-[#e3f2e8] text-[#14532d]',
    line: 'Fault mid-flush. Reverse-saga undid every applied step; state hashes match pre-tx.',
  },
  QUARANTINED_CONCURRENT_EDIT: {
    label: 'QUARANTINED',
    block: 'bg-[#fbebc8] text-[#5c3700]',
    pill: 'bg-[#fbebc8] text-[#5c3700]',
    line: 'A human edited the record mid-flush. Ablate refused to overwrite it and logged a 3-way diff.',
  },
  COMMITTED: {
    label: 'COMMITTED',
    block: 'bg-[#e3f2e8] text-[#14532d]',
    pill: 'bg-[#e3f2e8] text-[#14532d]',
    line: 'Passed every check and flushed to live services.',
  },
};

export const verdictOf = (s?: string) => VERDICT[s ?? ''] ?? VERDICT.COMMITTED;

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
    <section className={`rounded-xl border border-line bg-white ${className}`}>
      {title && (
        <div className="flex items-baseline justify-between gap-4 px-5 pt-4 pb-3">
          <h2 className="text-[17px] font-bold text-ink">{title}</h2>
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

export const short = (h?: string, n = 10) => (h ? (h.length > n ? `${h.slice(0, n)}…` : h) : '—');
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
    return over.length ? over.map((o) => `${o.tool} $${o.value.toLocaleString()}`).join(', ') + ` > $${Number(d.max_auto_usd).toLocaleString()}` : `≤ $${Number(d.max_auto_usd ?? 0).toLocaleString()}`;
  }
  if (c.name === 'iban_integrity') {
    const v = (d.violations as Array<{ requested: string; master: string }>) || [];
    return v.length ? `requested ${v[0].requested} ≠ master ${v[0].master}` : 'IBANs match vendor master';
  }
  if (c.name === 'provenance_taint') {
    const f = (d.findings as Array<{ tool: string; reason: string; field?: string }>) || [];
    return f.length ? f.map((x) => `${x.field ?? x.tool}: ${x.reason}`).slice(0, 2).join(' · ') : 'no untrusted values reach money fields';
  }
  if (c.name === 'ledger_balance') {
    const u = (d.unbalanced as unknown[]) || [];
    return u.length ? `${u.length} unbalanced entr${u.length > 1 ? 'ies' : 'y'}` : 'all entries balance';
  }
  if (c.name === 'inventory_non_negative') {
    const v = (d.violations as unknown[]) || [];
    return v.length ? `${v.length} SKU would go negative` : 'no SKU goes negative';
  }
  if (c.name.startsWith('dry_run')) return c.result === 'PASS' ? 'accepted by live API' : String(d.message ?? 'rejected');
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

export function DataTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (!rows.length) return <div className="px-4 py-3 text-[13px] text-muted">empty</div>;
  const cols = Object.keys(rows[0]);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left font-mono text-[12px]">
        <thead>
          <tr className="border-b border-line text-muted">
            {cols.map((c) => (
              <th key={c} className="px-3 py-2 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              {cols.map((c) => (
                <td key={c} className="whitespace-nowrap px-3 py-2">
                  {String(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

