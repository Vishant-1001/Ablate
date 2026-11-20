import type { ProxyEvent, TxReceipt } from '../types';
import { INVARIANT_META, Pill, checkTone } from './ui';

// Centre pane: the proxy. Staged deltas, the 3-layer gate, commit order and the
// reverse-saga timeline with millisecond offsets.

function ms(a: string, b: string) {
  return new Date(b).getTime() - new Date(a).getTime();
}

export default function ShadowPane({ events, receipt, aegis }: { events: ProxyEvent[]; receipt: TxReceipt | null; aegis: boolean }) {
  const staged = events.filter((e) => e.type === 'SHADOW_WRITE');
  const checks = events.filter((e) => e.phase === 'VALIDATE');
  const timeline = events.filter((e) => e.phase === 'FLUSH' || e.phase === 'ROLLBACK');
  const t0 = timeline[0]?.ts;
  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-line bg-white">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-[15px] font-bold">Ablate proxy</h2>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${aegis ? 'bg-[#e3f2e8] text-[#14532d]' : 'bg-danger text-white'}`}>
          {aegis ? 'SHADOW MODE' : 'OFF · LIVE PASSTHROUGH'}
        </span>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {!aegis && staged.length === 0 && (
          <p className="rounded-lg bg-[#fef7e6] px-3 py-2 text-[12px] text-[#5c3700]">
            Ablate is off: tool calls skip the shadow twin, the gate and the saga, and write straight to production.
          </p>
        )}

        <div>
          <div className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">Shadow twin · staged ({staged.length})</div>
          <ul className="space-y-1">
            {staged.map((e, i) => {
              const tool = e.message.split(' ')[0];
              const args = ((e.data as Record<string, unknown>).args ?? {}) as Record<string, unknown>;
              return (
                <li key={i} className="rounded-md bg-paper px-2.5 py-1.5">
                  <span className="font-mono text-[12px] font-semibold">{tool}</span>
                  <span className="ml-2 font-mono text-[11px] text-muted">
                    {Object.entries(args).filter(([k]) => k !== 'idempotency_key').map(([k, v]) => `${k}=${String(v)}`).join(' ')}
                  </span>
                </li>
              );
            })}
            {aegis && staged.length === 0 && <li className="text-[12px] text-muted">nothing staged</li>}
          </ul>
        </div>

        <div>
          <div className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">3-layer gate · 0 LLM tokens</div>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {checks.map((e, i) => {
              const m = e.message.match(/^L(\d) (\S+): (\S+)/);
              const name = m?.[2] ?? e.message;
              const res = m?.[3] ?? e.type;
              const key = name.startsWith('dry_run') ? 'dry_run' : name;
              return (
                <li key={i} className="flex items-center justify-between px-2.5 py-1.5">
                  <span className="text-[13px]">
                    <span className="mr-1.5 font-mono text-[10px] text-muted">L{m?.[1]}</span>
                    {INVARIANT_META[key]?.label ?? name}
                  </span>
                  <Pill tone={checkTone(res)}>{res === 'ESCALATE_HITL' ? 'ESCALATE' : res === 'FAIL' ? 'VIOLATION' : res}</Pill>
                </li>
              );
            })}
            {checks.length === 0 && <li className="px-2.5 py-2 text-[12px] text-muted">{aegis ? 'runs on commit' : 'skipped (Ablate off)'}</li>}
          </ul>
        </div>

        {receipt?.commit_order && receipt.commit_order.length > 0 && receipt.aegis_enabled && (
          <div>
            <div className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">Commit order · compensable → pivot last</div>
            <ol className="flex flex-wrap gap-1.5">
              {receipt.commit_order.map((t, i) => (
                <li key={i} className={`rounded px-2 py-1 font-mono text-[11px] ${t === 'billing.send_wire_payout' ? 'bg-ink text-white' : 'bg-[#f3f4f6] text-[#374151]'}`}>
                  {i + 1}. {t}
                </li>
              ))}
            </ol>
          </div>
        )}

        <div>
          <div className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">Flush &amp; reverse-saga</div>
          <ol className="relative space-y-1 border-l-2 border-line pl-3">
            {timeline.map((e, i) => {
              const bad = /FAILED|CONFLICT|QUARANTINED/.test(e.type);
              const undo = e.phase === 'ROLLBACK';
              return (
                <li key={i} className="text-[12px]">
                  <span className="font-mono text-[11px] text-muted">+{t0 ? ms(t0, e.ts) : 0} ms</span>{' '}
                  <span className={bad ? 'font-semibold text-danger' : undo ? 'text-[#5c3700]' : 'text-[#374151]'}>{e.message}</span>
                </li>
              );
            })}
            {timeline.length === 0 && <li className="text-[12px] text-muted">no live flush yet</li>}
          </ol>
          {typeof receipt?.rollback_ms === 'number' && (
            <div className="mt-2 text-[13px]">
              Reverse-saga completed in <span className="font-mono font-semibold">{receipt.rollback_ms.toFixed(1)} ms</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
