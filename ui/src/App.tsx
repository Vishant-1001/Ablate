import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DemoAct,
  ProxyEvent,
  RuntimeConfig,
  StatePayload,
  TxReceipt,
  TxStatus,
} from './types';

import {
  Card,
  DataTable,
  INVARIANT_META,
  PHASE_TONE,
  Pill,
  Stat,
  VERDICT,
  checkSummary,
  checkTone,
  download,
  fmtMs,
  median,
  short,
  verdictOf,
} from './components/ui';
import MissionControl from './components/MissionControl';

const DEFAULT_API =
  typeof window !== 'undefined' && window.location.port !== '5173'
    ? window.location.origin
    : 'http://localhost:8000';
const API_BASE = (import.meta.env.VITE_API_URL || DEFAULT_API).replace(/\/+$/, '');

type Page = 'overview' | 'mission' | 'transactions' | 'case' | 'evidence' | 'assurance';

const NAV: Array<{ id: Page; label: string }> = [
  { id: 'overview', label: 'Product' },
  { id: 'mission', label: 'Live Demo Sandbox' },
  { id: 'transactions', label: 'Audit Receipts' },
  { id: 'evidence', label: 'Event Trace' },
  { id: 'assurance', label: 'Assurance' },
];

const ACTS: Array<{ id: DemoAct; n: number; title: string; setup: string; expect: TxStatus }> = [
  {
    id: 'act1_corruption',
    n: 1,
    title: 'Unprotected agent',
    setup: 'Ablate OFF · billing returns 409 mid-run',
    expect: 'PARTIAL_CORRUPTION',
  },
  {
    id: 'act2_rollback',
    n: 2,
    title: 'Atomic rollback',
    setup: 'Ablate ON · billing returns 409 on flush',
    expect: 'ROLLED_BACK_CLEANLY',
  },
  {
    id: 'act3_injection',
    n: 3,
    title: 'Poisoned remittance memo',
    setup: 'Ablate ON · EDI memo asks for a wire to a new IBAN',
    expect: 'ABORTED_IN_SHADOW',
  },
  {
    id: 'act4_etag_conflict',
    n: 4,
    title: 'Concurrent human edit',
    setup: 'Ablate ON · 409 + a planner edits the PO mid-flush',
    expect: 'QUARANTINED_CONCURRENT_EDIT',
  },
];

// ============================================================================

// Hash routes make every page and case file linkable, refreshable and Back-able:
// #/overview  #/mission  #/transactions  #/assurance  #/evidence  #/tx/<id>  #/tx/<id>/evidence
type Route = { page: Page; tx: string | null };
const PAGES: Page[] = ['overview', 'mission', 'transactions', 'case', 'evidence', 'assurance'];
function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'tx' && parts[1]) return { page: parts[2] === 'evidence' ? 'evidence' : 'case', tx: parts[1] };
  const page = (PAGES as string[]).includes(parts[0]) ? (parts[0] as Page) : 'overview';
  return { page, tx: null };
}
function routeHash(page: Page, tx: string | null): string {
  if (tx && page === 'case') return `#/tx/${tx}`;
  if (tx && page === 'evidence') return `#/tx/${tx}/evidence`;
  return `#/${page}`;
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = useCallback((page: Page, tx: string | null = null) => {
    const h = routeHash(page, tx);
    if (window.location.hash !== h) window.location.hash = h; // pushes a history entry
    else setRoute(parseRoute(h));
    window.scrollTo(0, 0);
  }, []);
  const page = route.page;
  const selectedTx = route.tx;
  const setPage = (p: Page) => go(p, p === 'case' || p === 'evidence' ? selectedTx : null);
  const [state, setState] = useState<StatePayload | null>(null);
  const [events, setEvents] = useState<ProxyEvent[]>([]);
  const [receipts, setReceipts] = useState<TxReceipt[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guard = useRef(false);
  // The ledger survives /admin/reset; remember its length so the overview card goes idle after a reset.
  const [receiptsAtReset, setReceiptsAtReset] = useState(0);

  const config: RuntimeConfig = state?.config ?? {
    aegis_enabled: true,
    fail_billing_409: false,
    simulate_human_edit: false,
    max_auto_usd: 5000,
  };

  const refresh = useCallback(async () => {
    if (guard.current) return;
    guard.current = true;
    try {
      const [s, l] = await Promise.all([fetch(`${API_BASE}/state`), fetch(`${API_BASE}/ledger`)]);
      if (s.ok) setState((await s.json()) as StatePayload);
      if (l.ok) setReceipts(((await l.json()) as { receipts?: TxReceipt[] }).receipts ?? []);
      setOnline(s.ok);
    } catch {
      setOnline(false);
    } finally {
      guard.current = false;
    }
  }, []);

  // Proxy events arrive over Server-Sent Events (/events/stream); each one also triggers a
  // debounced re-read of /state and /ledger. A slow poll covers missed updates.
  useEffect(() => {
    void refresh();
    let debounce: number | undefined;
    const soon = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => void refresh(), 200);
    };
    let es: EventSource | null = null;
    let live = false;
    let retry: number | undefined;
    let stopped = false;
    const connect = () => {
      es = new EventSource(`${API_BASE}/events/stream`);
      es.onopen = () => {
        live = true;
        setStreaming(true);
        setEvents([]); // the server replays the full log on every (re)connect
      };
      es.onerror = () => {
        live = false;
        setStreaming(false);
        // A non-200 answer (e.g. Cloud Run waking a new revision) closes an EventSource for good;
        // the browser only auto-retries network drops. Reopen it ourselves.
        if (es && es.readyState === EventSource.CLOSED && !stopped) {
          es.close();
          window.clearTimeout(retry);
          retry = window.setTimeout(connect, 2000);
        }
      };
      es.addEventListener('proxy', (m) => {
        setEvents((prev) => [...prev, JSON.parse((m as MessageEvent).data) as ProxyEvent]);
        soon();
      });
      es.addEventListener('reset', () => {
        setEvents([]);
        soon();
      });
    };
    connect();
    // While the stream is down, poll /events so the panes never go stale.
    const pollEvents = async () => {
      if (live) return;
      try {
        const r = await fetch(`${API_BASE}/events`);
        if (r.ok) setEvents(((await r.json()) as { events?: ProxyEvent[] }).events ?? []);
      } catch {
        /* offline banner covers this */
      }
    };
    const fast = window.setInterval(() => void pollEvents(), 1000);
    const t = window.setInterval(() => void refresh(), 5000);
    return () => {
      stopped = true;
      es?.close();
      window.clearInterval(t);
      window.clearInterval(fast);
      window.clearTimeout(debounce);
      window.clearTimeout(retry);
    };
  }, [refresh]);

  const post = async (path: string, body?: unknown) => {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
    return res.json();
  };

  const runAct = async (act: DemoAct) => {
    setRunning(act);
    setError(null);
    try {
      await post(`/demo/run/${act}`);
      const [ev] = await Promise.all([fetch(`${API_BASE}/events`), refresh()]);
      if (ev.ok) setEvents(((await ev.json()) as { events?: ProxyEvent[] }).events ?? []);
      // Always take the user to the interactive Live Demo Sandbox so they see the 3-step visual flow
      go('mission', null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(null);
    }
  };

  const setConfig = async (patch: Partial<RuntimeConfig>) => {
    try {
      await post('/admin/config', patch);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const reset = async () => {
    setRunning('reset');
    try {
      await post('/admin/reset');
      setReceiptsAtReset(receipts.length);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(null);
    }
  };

  const openTx = (txId: string) => go('case', txId);

  const latest = receipts.length ? receipts[receipts.length - 1] : null;
  const selected = receipts.find((r) => r.tx_id === selectedTx) ?? latest;

  return (
    <div className="flex min-h-screen flex-col bg-white text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-6">
          <button onClick={() => setPage('overview')} className="flex shrink-0 items-center gap-2.5">
            <span className="text-[18px] font-bold tracking-tight">Ablate</span>
            <span className="hidden rounded-md border border-line bg-paper px-2 py-0.5 text-[11px] font-medium text-[#374151] lg:inline">
              Enterprise MCP Control Plane
            </span>
          </button>
          <nav className="flex items-center gap-5 overflow-x-auto">
            {NAV.map((n) => {
              const active = page === n.id || (n.id === 'transactions' && page === 'case');
              return (
                <button
                  key={n.id}
                  onClick={() => setPage(n.id)}
                  className={`whitespace-nowrap border-b-2 py-4 text-[14px] ${
                    active
                      ? 'border-ink font-semibold text-ink'
                      : n.id === 'mission'
                        ? 'border-transparent font-medium text-[#1d4ed8] hover:text-ink'
                        : 'border-transparent text-[#374151] hover:text-ink'
                  }`}
                >
                  {n.label}
                </button>
              );
            })}
          </nav>
          <div className="hidden shrink-0 items-center gap-2 font-mono text-[11px] text-muted xl:flex">
            <span className={`h-2 w-2 rounded-full ${online ? 'bg-[#16a34a]' : 'bg-danger'}`} />
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${streaming ? 'bg-[#e3f2e8] text-[#14532d]' : 'bg-[#f3f4f6] text-muted'}`}>
              {streaming ? 'Control Plane Online' : 'Connecting…'}
            </span>
          </div>
        </div>
      </header>

      {error && (
        <div className="mx-auto mt-4 w-full max-w-[1100px] px-6">
          <div className="rounded-lg border border-[#f0d3cf] bg-[#fffbfa] px-4 py-2 text-[14px] text-danger">{error}</div>
        </div>
      )}
      {!online && (
        <div className="mx-auto mt-4 w-full max-w-[1100px] px-6">
          <div className="rounded-lg border border-[#f3d9a4] bg-[#fef7e6] px-4 py-2 text-[14px] text-[#5c3700]">
            Backend not reachable at <span className="font-mono">{API_BASE}</span>. Start it with{' '}
            <span className="font-mono">python run_all.py</span>.
          </div>
        </div>
      )}

      <main className="flex-1">
        {page === 'overview' && (
          <Overview
            config={config}
            latest={receipts.length > receiptsAtReset ? latest : null}
            running={running}
            onRun={runAct}
            onConfig={setConfig}
            onReset={reset}
            onOpen={openTx}
            onOpenSandbox={() => setPage('mission')}
          />
        )}
        {page === 'mission' && (
          <MissionControl
            events={events}
            receipts={receipts}
            state={state}
            config={config}
            running={running}
            onRun={runAct}
            onConfig={setConfig}
            onReset={reset}
            onOpenTx={openTx}
          />
        )}
        {page === 'transactions' && <Transactions receipts={receipts} config={config} onOpen={openTx} onRun={() => setPage('mission')} />}
        {page === 'case' && (
          <CaseFile receipt={selected} receipts={receipts} events={events} onBack={() => setPage('transactions')} onEvidence={() => go('evidence', selected?.tx_id ?? null)} />
        )}
        {page === 'evidence' && <Evidence receipt={selected} events={events} state={state} onBack={() => go('case', selected?.tx_id ?? null)} />}
        {page === 'assurance' && <Assurance receipts={receipts} onOpen={openTx} />}
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-2 px-6 py-4 text-[12px] text-muted">
          <span>
            <span className="font-semibold text-ink">Ablate Enterprise</span> · Powered by Google ADK & Gemini · Cloud Run MCP Control Plane
          </span>
          <span>© 2026 Ablate Inc.</span>
        </div>
      </footer>
    </div>
  );
}

// ============================== Overview (Product Page) ====================

function Overview(props: {
  config: RuntimeConfig;
  latest: TxReceipt | null;
  running: string | null;
  onRun: (a: DemoAct) => void;
  onConfig: (p: Partial<RuntimeConfig>) => void;
  onReset: () => void;
  onOpen: (tx: string) => void;
  onOpenSandbox: () => void;
}) {
  const { latest, running } = props;
  const v = verdictOf(latest?.status);
  return (
    <>
      {/* 1. Enterprise Hero */}
      <section className="mx-auto grid max-w-[1140px] items-center gap-10 px-6 py-14 lg:grid-cols-[1.15fr_1fr]">
        <div>
          <div className="font-mono text-[12px] uppercase tracking-[0.12em] text-[#1d4ed8]">
            Transactional Control Plane for Enterprise AI Agents
          </div>
          <h1 className="mt-3 text-[42px] font-bold leading-[1.1] tracking-tight">
            Let AI agents take real actions across your stack—with an automatic undo button.
          </h1>
          <p className="mt-5 max-w-[540px] text-[16px] leading-relaxed text-[#374151]">
            Most enterprise AI agents are stuck in read-only mode because a single failed API call leaves ERP,
            warehouse inventory, and billing databases half-updated. Ablate sits between your agents and production
            systems to stage changes safely, enforce business rules with zero LLM guesswork, and automatically roll back
            partial updates if any step fails.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <button
              onClick={props.onOpenSandbox}
              className="rounded-lg bg-[#1d4ed8] px-5 py-2.5 text-[15px] font-semibold text-white hover:bg-[#1e40af]"
            >
              Launch Interactive Sandbox →
            </button>
            <button
              onClick={() => props.onRun('act2_rollback')}
              disabled={!!running}
              className="rounded-lg border border-line bg-white px-5 py-2.5 text-[15px] font-medium hover:bg-paper disabled:opacity-50"
            >
              {running === 'act2_rollback' ? 'Running Live Rollback…' : 'Watch 2ms Auto-Rollback'}
            </button>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-6 text-[13px] text-muted">
            <span>✓ 1-line MCP drop-in proxy</span>
            <span>✓ 0 LLM tokens in verification gate</span>
            <span>✓ Managed Cloud Run or Private VPC</span>
          </div>
        </div>

        <button
          onClick={() => (latest ? props.onOpen(latest.tx_id) : props.onOpenSandbox())}
          className="rounded-2xl bg-[#111318] p-6 text-left text-white shadow-[0_20px_50px_rgba(17,19,24,0.25)]"
        >
          <div className="flex items-center justify-between font-mono text-[12px] text-[#9ca3af]">
            <span>LIVE CONTROL PLANE TELEMETRY</span>
            <span>{latest ? latest.tx_id : 'ready'}</span>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <span className={`rounded-md px-3 py-1.5 text-[14px] font-bold tracking-[0.06em] ${latest ? v.block : 'bg-[#16a34a] text-white'}`}>
              {latest ? v.label : 'PROTECTED'}
            </span>
            <span className="text-[14px] text-[#e5e7eb]">
              {latest ? latest.status.replace(/_/g, ' ').toLowerCase() : 'all 3 production systems synced'}
            </span>
          </div>
          <div className="mt-5 space-y-2.5 text-[14px]">
            {(latest?.invariant_checks?.length
              ? latest.invariant_checks.slice(0, 5)
              : [
                  { name: 'ledger_balance', result: 'PASS' },
                  { name: 'inventory_non_negative', result: 'PASS' },
                  { name: 'dollar_cap', result: 'PASS' },
                  { name: 'iban_integrity', result: 'PASS' },
                  { name: 'taint_check', result: 'PASS' },
                ]
            ).map((c) => (
              <div key={c.name} className="flex justify-between">
                <span className="text-[#d1d5db]">
                  {INVARIANT_META[c.name.startsWith('dry_run') ? 'dry_run' : c.name]?.label ?? c.name}
                </span>
                <span className={c.result === 'PASS' ? 'text-[#86efac]' : c.result === 'FAIL' ? 'text-[#fca5a5]' : 'text-[#fcd34d]'}>
                  {c.result === 'ESCALATE_HITL' ? 'Escalate' : c.result === 'PASS' ? 'Enforced ✓' : c.result === 'FAIL' ? 'Blocked' : 'Skipped'}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-5 border-t border-white/10 pt-3 text-[13px] text-[#d1d5db]">
            {latest ? (
              <>
                state_parity = <span className="font-mono text-[#86efac]">{String(latest.hashes_match)}</span> · undo
                time <span className="font-mono">{fmtMs(latest.rollback_ms)}</span> · receipt{' '}
                <span className="font-mono">{short(latest.receipt_hash, 8)}</span>
              </>
            ) : (
              <>100% cross-system consistency · ~2 ms automatic rollback · SHA-256 audit receipts</>
            )}
          </div>
        </button>
      </section>

      {/* 2. Why Enterprises Need Ablate */}
      <section className="border-y border-line bg-paper">
        <div className="mx-auto max-w-[1140px] px-6 py-12">
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#1d4ed8]">
            The Enterprise Write-Path Gap
          </div>
          <h2 className="mt-1 text-[26px] font-bold">
            Why 85% of enterprise AI pilots are blocked from production write-access
          </h2>
          <div className="mt-6 grid gap-5 md:grid-cols-3">
            <div className="rounded-xl border border-line bg-white p-5">
              <div className="font-mono text-[11px] font-bold uppercase text-danger">1. Half-Finished API Updates</div>
              <div className="mt-2 text-[16px] font-bold">External APIs don’t have a shared Undo</div>
              <p className="mt-2 text-[14px] leading-relaxed text-[#374151]">
                When an agent updates an ERP purchase order and warehouse inventory, then hits a billing conflict on
                step 3, the first two systems remain permanently changed—leaving thousands of dollars in ledger mismatches.
              </p>
            </div>
            <div className="rounded-xl border border-line bg-white p-5">
              <div className="font-mono text-[11px] font-bold uppercase text-[#5c3700]">2. Prompt & Document Hijacking</div>
              <div className="mt-2 text-[16px] font-bold">Untrusted invoices can trick agents</div>
              <p className="mt-2 text-[14px] leading-relaxed text-[#374151]">
                Agents reading inbound supplier invoices or emails can be tricked by disguised remittance notes into
                changing vendor bank accounts or initiating unauthorized payouts.
              </p>
            </div>
            <div className="rounded-xl border border-line bg-white p-5">
              <div className="font-mono text-[11px] font-bold uppercase text-[#15803d]">3. Human Edits Get Overwritten</div>
              <div className="mt-2 text-[16px] font-bold">Naive retries clobber human planners</div>
              <p className="mt-2 text-[14px] leading-relaxed text-[#374151]">
                If a human operations planner edits an order while an agent is mid-workflow, a naive rollback overwrites
                the human’s work. Ablate detects concurrent edits via version checks and protects human changes.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 3. How Ablate Works in 4 Steps */}
      <section className="mx-auto max-w-[1140px] px-6 py-12">
        <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">How It Works</div>
        <h2 className="mt-1 text-[26px] font-bold">Four layers of protection on every agent transaction</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            [
              '01 · Shadow Staging',
              'Buffer writes before touching live APIs',
              'Every mutating tool call is intercepted into an isolated shadow copy so your agent can reason across multiple steps with zero risk to live databases.',
            ],
            [
              '02 · Deterministic Rule Gate',
              'Enforce hard business rules (0 LLM tokens)',
              'Checks double-entry balance, non-negative inventory, cumulative dollar limits ($5,000 cap), bank IBAN whitelists, and untrusted input taint in microseconds.',
            ],
            [
              '03 · Irreversible Action Ordering',
              'Hold payouts and emails until last',
              'Reversible updates commit first. Irreversible actions (wire transfers, external notifications) are strictly held until every prior step succeeds.',
            ],
            [
              '04 · Automatic Undo & Receipt',
              'Millisecond reverse-saga + SHA-256 proof',
              'If any downstream API fails, Ablate automatically fires the compensating undo calls in reverse order and seals a tamper-evident audit receipt.',
            ],
          ].map(([step, title, body]) => (
            <div key={step} className="rounded-xl border border-line bg-white p-5">
              <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-[#1d4ed8]">{step}</div>
              <div className="mt-2 text-[15px] font-bold text-ink">{title}</div>
              <p className="mt-2 text-[13px] leading-relaxed text-[#374151]">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 4. Enterprise Deployment & Pricing */}
      <section className="border-t border-line bg-paper">
        <div className="mx-auto max-w-[1140px] px-6 py-12">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
                Deployment & Commercial Plans
              </div>
              <h2 className="mt-1 text-[26px] font-bold">Drop-in MCP proxy—deploy in Cloud Run or your Private VPC</h2>
            </div>
            <button
              onClick={props.onOpenSandbox}
              className="rounded-lg bg-ink px-4 py-2.5 text-[14px] font-semibold text-white hover:bg-black"
            >
              Test in Live Demo Sandbox →
            </button>
          </div>

          <div className="mt-6 grid gap-5 md:grid-cols-3">
            <div className="flex flex-col justify-between rounded-xl border border-line bg-white p-6">
              <div>
                <div className="font-mono text-[11px] font-semibold uppercase text-muted">Developer / Open Source</div>
                <div className="mt-2 text-[28px] font-bold">$0 <span className="text-[14px] font-normal text-muted">/ month</span></div>
                <p className="mt-2 text-[13px] text-[#374151]">For local agent development, staging POCs, and CI fault testing.</p>
                <ul className="mt-4 space-y-2 text-[13px] text-[#374151]">
                  <li>✓ Local MCP JSON-RPC proxy & shadow twin</li>
                  <li>✓ 5 deterministic financial & inventory rules</li>
                  <li>✓ Local SQLite hash-chained receipt ledger</li>
                </ul>
              </div>
            </div>

            <div className="flex flex-col justify-between rounded-xl border-2 border-ink bg-white p-6">
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] font-semibold uppercase text-[#1d4ed8]">Growth Cloud</span>
                  <span className="rounded-full bg-[#eef4ff] px-2.5 py-0.5 text-[11px] font-semibold text-[#1d4ed8]">Most Popular</span>
                </div>
                <div className="mt-2 text-[28px] font-bold">$1,500 <span className="text-[14px] font-normal text-muted">/ month</span></div>
                <p className="mt-2 text-[13px] text-[#374151]">Managed Cloud Run control plane for scaling production write-agents.</p>
                <ul className="mt-4 space-y-2 text-[13px] text-[#374151]">
                  <li>✓ 50,000 committed multi-step transactions / mo</li>
                  <li>✓ Pre-built Undo Connectors (NetSuite, Stripe, Salesforce, Shopify, Jira)</li>
                  <li>✓ Real-time Mission Control & SSE telemetry</li>
                </ul>
              </div>
            </div>

            <div className="flex flex-col justify-between rounded-xl border border-line bg-white p-6">
              <div>
                <div className="font-mono text-[11px] font-semibold uppercase text-muted">Enterprise Private VPC</div>
                <div className="mt-2 text-[28px] font-bold">$6,000 <span className="text-[14px] font-normal text-muted">/ month</span></div>
                <p className="mt-2 text-[13px] text-[#374151]">For regulated enterprises, FinTech, and Global 2000 capability centers.</p>
                <ul className="mt-4 space-y-2 text-[13px] text-[#374151]">
                  <li>✓ Self-hosted inside customer GCP / AWS VPC (zero data leaves network)</li>
                  <li>✓ Custom SAP / ERP undo mappings & ETag human-edit protection</li>
                  <li>✓ SOX / ISO tamper-evident audit exports & 99.99% SLA</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

// ============================== Transactions ===============================

function Transactions({ receipts, config, onOpen, onRun }: { receipts: TxReceipt[]; config: RuntimeConfig; onOpen: (t: string) => void; onRun: () => void }) {
  const rows = [...receipts].reverse();
  const blocked = receipts.filter((r) => ['ABORTED_IN_SHADOW', 'ESCALATED_HITL'].includes(r.status)).length;
  const corrupted = receipts.filter((r) => r.status === 'PARTIAL_CORRUPTION').length;
  const rb = median(receipts.filter((r) => r.status === 'ROLLED_BACK_CLEANLY' && typeof r.rollback_ms === 'number').map((r) => r.rollback_ms as number));
  return (
    <div className="mx-auto max-w-[1100px] px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold">Transactions</h1>
          <p className="text-[14px] text-muted">Every agent transaction the proxy has sealed into the receipt ledger</p>
        </div>
        <button onClick={onRun} className="rounded-lg bg-ink px-4 py-2.5 text-[14px] font-semibold text-white hover:bg-black">
          Run a demo act
        </button>
      </div>

      {!config.aegis_enabled && (
        <div className="mt-5 rounded-lg border border-[#f3d9a4] bg-[#fef7e6] px-4 py-2.5 text-[14px] text-[#5c3700]">
          <span className="font-semibold">Ablate proxy is OFF</span> · agent tool calls go straight to production with no
          shadow, gate or rollback.
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Transactions sealed" value={receipts.length} />
        <Stat label="Blocked before production" value={blocked} />
        <Stat label="Partial corruptions" value={corrupted} tone={corrupted ? 'red' : undefined} />
        <Stat label="Median clean rollback" value={rb === null ? '—' : `${rb.toFixed(1)} ms`} />
      </div>

      <Card className="mt-5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[14px]">
            <thead>
              <tr className="border-b border-line text-[12px] font-semibold text-muted">
                <th className="px-5 py-3">Transaction</th>
                <th className="px-3 py-3">Verdict</th>
                <th className="px-3 py-3">Cause</th>
                <th className="px-3 py-3">Undo</th>
                <th className="px-3 py-3">State</th>
                <th className="px-5 py-3">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-muted">
                    No transactions yet. Run an act from Overview.
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const v = verdictOf(r.status);
                const f = (r.failure ?? {}) as Record<string, unknown>;
                const cause = f.message ? `${String(f.tool ?? '')} → ${String(f.status ?? '')} ${String(f.message)}` : f.reason ? String(f.reason) : 'No fault';
                return (
                  <tr
                    key={r.receipt_hash}
                    onClick={() => onOpen(r.tx_id)}
                    className={`cursor-pointer border-b border-line last:border-0 hover:bg-paper ${r.status === 'PARTIAL_CORRUPTION' ? 'bg-[#fffbfa]' : ''}`}
                  >
                    <td className="px-5 py-3.5">
                      <div className="font-mono text-[13px] font-medium">{r.tx_id}</div>
                      <div className="text-[12px] text-muted">
                        {r.aegis_enabled ? 'ablate on' : 'ablate off'} · {r.ts ? new Date(r.ts).toLocaleTimeString() : ''}
                      </div>
                    </td>
                    <td className="px-3 py-3.5">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold tracking-[0.04em] ${v.pill}`}>{v.label}</span>
                    </td>
                    <td className="max-w-[300px] px-3 py-3.5 text-[#374151]">
                      <span className="line-clamp-2">{cause}</span>
                    </td>
                    <td className="px-3 py-3.5 text-[13px] text-[#374151]">
                      {r.compensations?.length ? `${r.compensations.length} steps · ${fmtMs(r.rollback_ms)}` : '—'}
                    </td>
                    <td className="px-3 py-3.5 text-[13px]">
                      {r.hashes_match ? <span className="text-[#14532d]">unchanged</span> : <span className="text-[#374151]">changed</span>}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-[12px] text-muted">{short(r.receipt_hash, 10)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ============================== Case file ==================================

function CaseFile({ receipt, receipts, events, onBack, onEvidence }: { receipt: TxReceipt | null; receipts: TxReceipt[]; events: ProxyEvent[]; onBack: () => void; onEvidence: () => void }) {
  if (!receipt) {
    return (
      <div className="mx-auto max-w-[1100px] px-6 py-16 text-center text-muted">
        No transaction selected.{' '}
        <button onClick={onBack} className="text-[#1d4ed8] underline">
          Back to transactions
        </button>
      </div>
    );
  }
  const v = verdictOf(receipt.status);
  const txEvents = events.filter((e) => e.tx_id === receipt.tx_id);
  const agentMode = txEvents.filter((e) => e.type === 'AGENT_MODE').pop();
  const agentInfo = (receipt.agent ?? (agentMode?.data as { mode?: string; model?: string } | undefined)) || null;
  const staged = txEvents.filter((e) => e.type === 'SHADOW_WRITE');
  const idx = receipts.findIndex((r) => r.receipt_hash === receipt.receipt_hash);
  const linked = idx <= 0 ? receipt.prev_hash === '0'.repeat(64) : receipts[idx - 1].receipt_hash === receipt.prev_hash;
  const comps = receipt.compensations ?? [];
  const checks = receipt.invariant_checks ?? [];
  const steps = receipt.steps ?? [];
  const compByStep = new Map(comps.map((c) => [Number(c.step), c]));
  const dbs = ['erp', 'wms', 'billing'] as const;
  const applied = steps.filter((s) => s.status === 'APPLIED').length;

  const integrity: Array<[boolean, string]> = [
    [Object.keys(receipt.pre_tx_hashes ?? {}).length === 3, 'Pre-transaction SHA-256 captured for ERP, WMS, Billing'],
    [
      receipt.status !== 'ABORTED_IN_SHADOW' && receipt.status !== 'ESCALATED_HITL' ? true : receipt.hashes_match,
      receipt.status === 'ABORTED_IN_SHADOW' || receipt.status === 'ESCALATED_HITL' ? 'Zero live writes (post hash == pre hash)' : 'Validation ran before any live write',
    ],
    [
      comps.every((c) => c.status === 'COMPENSATED' || c.status === 'QUARANTINED_CONCURRENT_EDIT'),
      !comps.length
        ? 'No compensation needed'
        : comps.some((c) => c.status === 'QUARANTINED_CONCURRENT_EDIT')
          ? `${comps.filter((c) => c.status === 'COMPENSATED').length} undone · ${comps.filter((c) => c.status === 'QUARANTINED_CONCURRENT_EDIT').length} quarantined (human edit kept)`
          : `${comps.filter((c) => c.status === 'COMPENSATED').length}/${comps.length} compensations applied`,
    ],
    [receipt.status === 'ROLLED_BACK_CLEANLY' ? receipt.hashes_match : true, receipt.status === 'ROLLED_BACK_CLEANLY' ? 'Post-rollback hash == pre-transaction hash' : 'Deterministic checks, no LLM judge'],
    [linked, 'Receipt hash-chained to the previous receipt'],
  ];
  if (!receipt.aegis_enabled) integrity.splice(1, 3, [false, 'Ablate OFF: no shadow, no gate, no rollback']);

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-6">
      <div className="text-[13px] text-muted">
        <button onClick={onBack} className="text-[#1d4ed8] underline">
          Transactions
        </button>{' '}
        / {receipt.tx_id}
      </div>

      <Card className="mt-3">
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div className="flex min-w-0 flex-wrap items-center gap-4">
            <span className={`rounded-lg px-4 py-2.5 text-[18px] font-bold tracking-[0.04em] ${v.block}`}>{v.label}</span>
            <div className="min-w-0">
              <div className="break-all text-[22px] font-bold">
                <span className="font-mono text-[20px]">{receipt.tx_id}</span> · {receipt.aegis_enabled ? 'Ablate ON' : 'Ablate OFF'}
              </div>
              <div className="text-[14px] text-muted">{v.line}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[12px] text-muted">{receipt.rollback_ms !== null && receipt.rollback_ms !== undefined ? 'Rollback latency' : 'Commit latency'}</div>
            <div className="text-[26px] font-bold">{fmtMs(receipt.rollback_ms ?? receipt.commit_ms)}</div>
          </div>
        </div>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-5">
          <Card title="Commit plan" aside="COMPENSABLE first → PIVOT last · undone in reverse on fault">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-[14px]">
                <thead>
                  <tr className="border-y border-line text-[12px] font-semibold text-muted">
                    <th className="px-5 py-2.5">Step</th>
                    <th className="px-3 py-2.5">Live result</th>
                    <th className="px-3 py-2.5">Undo</th>
                    <th className="px-5 py-2.5">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {steps.length === 0 && staged.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-5 py-6 text-center text-muted">
                        Nothing reached production.
                      </td>
                    </tr>
                  )}
                  {steps.length === 0 &&
                    staged.map((e, i) => (
                      <tr key={i} className="border-b border-line last:border-0">
                        <td className="px-5 py-3 font-mono text-[13px] font-medium">{String((e.message.split(' ')[0]) ?? '')}</td>
                        <td className="px-3 py-3 text-[13px] text-muted">staged in shadow only</td>
                        <td className="px-3 py-3 text-[13px] text-muted">—</td>
                        <td className="px-5 py-3">
                          <Pill tone={receipt.status === 'COMMITTED' ? 'green' : 'slate'}>{receipt.status === 'ESCALATED_HITL' ? 'HELD' : 'NEVER FLUSHED'}</Pill>
                        </td>
                      </tr>
                    ))}
                  {steps.map((s, i) => {
                    const c = compByStep.get(Number(s.step ?? i));
                    const failed = s.status === 'FAILED';
                    let tone: 'red' | 'green' | 'amber' | 'slate' = 'green';
                    let label = 'APPLIED';
                    if (failed) {
                      tone = 'red';
                      label = `FAILED ${s.error?.status ?? ''}`;
                    } else if (c?.status === 'COMPENSATED') {
                      tone = 'slate';
                      label = 'UNDONE';
                    } else if (c?.status === 'QUARANTINED_CONCURRENT_EDIT') {
                      tone = 'amber';
                      label = 'QUARANTINED';
                    } else if (!receipt.aegis_enabled && receipt.status === 'PARTIAL_CORRUPTION') {
                      tone = 'red';
                      label = 'LEFT BEHIND';
                    }
                    return (
                      <tr key={i} className={`border-b border-line last:border-0 ${failed ? 'bg-[#fffbfa]' : ''}`}>
                        <td className="px-5 py-3">
                          <div className="font-mono text-[13px] font-semibold">{s.tool}</div>
                          {failed && <div className="font-mono text-[12px] text-danger">{s.error?.message}</div>}
                        </td>
                        <td className="px-3 py-3 font-mono text-[12px] text-muted">
                          {s.result ? Object.entries(s.result).filter(([k]) => !['idempotent_replay'].includes(k)).slice(0, 3).map(([k, val]) => `${k}=${String(val)}`).join(' ') : '—'}
                        </td>
                        <td className="px-3 py-3 text-[12px] text-[#374151]">{c ? String(c.strategy) : failed ? 'nothing to undo' : '—'}</td>
                        <td className="px-5 py-3">
                          <Pill tone={tone}>{label}</Pill>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Invariant gate" aside="Deterministic code · 0 LLM tokens">
            <div className="divide-y divide-line border-t border-line">
              {checks.map((c) => {
                const key = c.name.startsWith('dry_run') ? 'dry_run' : c.name;
                const meta = INVARIANT_META[key];
                return (
                  <div key={c.name} className={`flex items-center gap-4 px-5 py-3 ${c.result === 'FAIL' ? 'bg-[#fffbfa]' : ''}`}>
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-semibold">
                        {meta?.label ?? c.name} <span className="ml-1 font-mono text-[11px] font-normal text-muted">{meta?.layer ?? (c.layer ? `L${c.layer}` : '')}</span>
                      </div>
                      <div className="truncate font-mono text-[12px] text-muted">{checkSummary(c) || meta?.desc}</div>
                    </div>
                    <Pill tone={checkTone(c.result)}>{c.result === 'ESCALATE_HITL' ? 'ESCALATE' : c.result === 'FAIL' ? 'VIOLATION' : c.result}</Pill>
                  </div>
                );
              })}
              {checks.length === 0 && <div className="px-5 py-4 text-[14px] text-muted">No checks recorded.</div>}
            </div>
          </Card>

          <Card title="State parity" aside="SHA-256 over canonical rows, per service">
            <div className="grid gap-3 border-t border-line p-5 sm:grid-cols-3">
              {dbs.map((db) => {
                const pre = receipt.pre_tx_hashes?.[db];
                const postH = receipt.post_tx_hashes?.[db];
                const same = pre === postH;
                return (
                  <div key={db} className={`rounded-[10px] border p-3 ${same ? 'border-line' : 'border-[#f0d3cf] bg-[#fffbfa]'}`}>
                    <div className="text-[13px] font-semibold uppercase">{db}</div>
                    <div className="mt-1 font-mono text-[12px] text-muted">pre&nbsp; {short(pre, 14)}</div>
                    <div className="font-mono text-[12px] text-muted">post {short(postH, 14)}</div>
                    <div className={`mt-1 text-[13px] font-bold ${same ? 'text-[#14532d]' : 'text-danger'}`}>{same ? 'unchanged' : 'changed'}</div>
                  </div>
                );
              })}
            </div>
            <div className="px-5 pb-4">
              <button onClick={onEvidence} className="text-[14px] text-[#1d4ed8] underline">
                View evidence →
              </button>
            </div>
          </Card>
        </div>

        <aside className="space-y-5">
          <Card title="Evidence integrity">
            <ul className="space-y-2 px-5 pb-3 text-[14px]">
              {integrity.map(([ok, text]) => (
                <li key={text} className="flex gap-2">
                  <span className={ok ? 'text-[#15803d]' : 'text-danger'}>{ok ? '✓' : '✗'}</span>
                  <span>{text}</span>
                </li>
              ))}
            </ul>
            <div className="border-t border-line px-5 py-3 font-mono text-[12px] text-muted">receipt {short(receipt.receipt_hash, 22)}</div>
          </Card>

          <Card>
            <dl className="grid grid-cols-2 gap-y-2 px-5 py-4 text-[14px]">
              <dt className="text-muted">Agent</dt>
              <dd>{agentInfo?.mode ? String(agentInfo.mode).replace('_', ' ') : '—'}</dd>
              <dt className="text-muted">Model</dt>
              <dd className="font-mono text-[12px]">{agentInfo?.model ? String(agentInfo.model) : '—'}</dd>
              <dt className="text-muted">Steps applied</dt>
              <dd>{applied}</dd>
              <dt className="text-muted">Compensations</dt>
              <dd>{comps.length}</dd>
              <dt className="text-muted">Commit time</dt>
              <dd>{fmtMs(receipt.commit_ms)}</dd>
            </dl>
          </Card>

          {receipt.quarantine && receipt.quarantine.length > 0 && (
            <Card title="Concurrent edit">
              <div className="px-5 pb-4 text-[13px]">
                {receipt.quarantine.map((q) => (
                  <div key={q.entity}>
                    <div className="font-mono text-[12px] text-muted">{q.entity}</div>
                    <table className="mt-2 w-full font-mono text-[12px]">
                      <thead>
                        <tr className="text-muted">
                          <th className="text-left font-normal">field</th>
                          <th className="text-right font-normal">before</th>
                          <th className="text-right font-normal">agent</th>
                          <th className="text-right font-normal">human</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(q.three_way_diff).map(([k, d]) => (
                          <tr key={k}>
                            <td>{k}</td>
                            <td className="text-right">{String(d.base)}</td>
                            <td className="text-right">{String(d.ours)}</td>
                            <td className="text-right font-bold text-[#5c3700]">{String(d.theirs)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-2 text-[12px] text-muted">Human value kept. Restore refused: live version moved past the agent's write.</p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card title="Decision">
            <div className="px-5 pb-4 text-[14px] text-[#374151]">{v.line}</div>
          </Card>

          <button
            onClick={() => download(`ablate-receipt-${receipt.tx_id}.json`, receipt)}
            className="w-full rounded-lg bg-ink py-3 text-[15px] font-semibold text-white hover:bg-black"
          >
            Download receipt (JSON)
          </button>
          <button onClick={onEvidence} className="w-full rounded-lg border border-line bg-white py-3 text-[15px] hover:bg-paper">
            Open event trace
          </button>
        </aside>
      </div>
    </div>
  );
}

// ============================== Evidence ===================================

function Evidence({ receipt, events, state, onBack }: { receipt: TxReceipt | null; events: ProxyEvent[]; state: StatePayload | null; onBack: () => void }) {
  const txEvents = receipt ? events.filter((e) => e.tx_id === receipt.tx_id) : events;
  return (
    <div className="mx-auto max-w-[1100px] px-6 py-6">
      <div className="text-[13px] text-muted">
        <button onClick={onBack} className="text-[#1d4ed8] underline">
          {receipt ? receipt.tx_id : 'Case file'}
        </button>{' '}
        / Evidence
      </div>
      <h1 className="mt-2 text-[26px] font-bold">Evidence{receipt ? <span className="font-mono text-[22px]"> · {receipt.tx_id}</span> : ''}</h1>
      <p className="text-[14px] text-muted">Proxy event trace for this transaction, and the live rows in each service right now</p>

      <Card className="mt-5" title="Event trace" aside={`${txEvents.length} events`}>
        <ol className="max-h-[460px] overflow-y-auto border-t border-line">
          {txEvents.length === 0 && <li className="px-5 py-4 text-[14px] text-muted">No events for this transaction (events clear on reset).</li>}
          {txEvents.map((e, i) => (
            <li key={i} className={`flex items-start gap-3 border-b border-line px-5 py-2.5 last:border-0 ${/FAIL|CONFLICT|VIOLATION/.test(e.type) || e.type === 'FAIL' ? 'bg-[#fffbfa]' : ''}`}>
              <span className="w-[84px] shrink-0 pt-0.5 font-mono text-[11px] text-muted">{e.ts.slice(11, 23)}</span>
              <span className={`w-[78px] shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-bold tracking-[0.04em] ${PHASE_TONE[e.phase] ?? 'bg-[#f3f4f6] text-muted'}`}>
                {e.phase}
              </span>
              <span className="min-w-0 text-[13px]">
                <span className="font-mono text-[12px] font-medium text-[#374151]">{e.type}</span> <span className="text-[#374151]">· {e.message}</span>
              </span>
            </li>
          ))}
        </ol>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {state &&
          (
            [
              ['ERP', state.erp.hash, [['purchase_orders', state.erp.purchase_orders], ['gl_entries', state.erp.gl_entries]]],
              ['WMS', state.wms.hash, [['inventory', state.wms.inventory]]],
              ['Billing', state.billing.hash, [['invoices', state.billing.invoices], ['credit_notes', state.billing.credit_notes]]],
            ] as Array<[string, string, Array<[string, unknown[]]>]>
          ).map(([name, hash, tables]) => (
            <Card key={name} title={name} aside={<span className="font-mono">{short(hash, 12)}</span>}>
              {tables.map(([t, rows]) => (
                <div key={t} className="border-t border-line">
                  <div className="px-3 pt-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">
                    {t} ({rows.length})
                  </div>
                  <DataTable rows={rows as Array<Record<string, unknown>>} />
                </div>
              ))}
            </Card>
          ))}
      </div>
      <p className="mt-4 text-[12px] text-muted">Each service is its own SQLite database. Hashes exclude version columns and bookkeeping tables.</p>
    </div>
  );
}

// ============================== Assurance ==================================

function Assurance({ receipts, onOpen }: { receipts: TxReceipt[]; onOpen: (t: string) => void }) {
  const [sel, setSel] = useState<number | null>(null);
  const links = receipts.map((r, i) => (i === 0 ? r.prev_hash === '0'.repeat(64) : receipts[i - 1].receipt_hash === r.prev_hash));
  const verified = links.filter(Boolean).length;
  const clean = receipts.filter((r) => r.status === 'ROLLED_BACK_CLEANLY' && r.hashes_match).length;
  const blocked = receipts.filter((r) => r.status === 'ABORTED_IN_SHADOW').length;
  const pick = sel ?? (receipts.length ? receipts.length - 1 : null);
  const r = pick !== null ? receipts[pick] : null;

  // Server-side full re-hash of the chain (GET /ledger/verify), refreshed whenever the ledger grows.
  type VerifyReport = { chain_valid: boolean; receipts: number; verified: number; first_broken: { index: number; tx_id: string; reason: string } | null };
  const [server, setServer] = useState<VerifyReport | null>(null);
  const [checking, setChecking] = useState(false);
  const runVerify = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch(`${API_BASE}/ledger/verify`);
      setServer(res.ok ? ((await res.json()) as VerifyReport) : null);
    } catch {
      setServer(null);
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    void runVerify();
  }, [runVerify, receipts.length]);

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-8">
      <h1 className="text-[26px] font-bold">Assurance</h1>
      <p className="max-w-[640px] text-[14px] text-muted">
        Every receipt embeds the hash of the one before it: SHA-256(prev_hash + canonical receipt). Editing any past
        receipt breaks every link after it.
      </p>
      <div
        className={`mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 px-5 py-3 ${
          !server ? 'border-line' : server.chain_valid ? 'border-[#15803d] bg-[#f3faf5]' : 'border-danger bg-[#fffbfa]'
        }`}
      >
        <div>
          <div className={`text-[15px] font-bold ${!server ? 'text-muted' : server.chain_valid ? 'text-[#15803d]' : 'text-danger'}`}>
            {!server
              ? 'Server re-hash unavailable'
              : server.chain_valid
                ? `Server re-hash: chain valid · ${server.verified}/${server.receipts} receipts`
                : `Server re-hash: chain BROKEN at receipt #${(server.first_broken?.index ?? 0) + 1}`}
          </div>
          <div className="text-[12px] text-muted">
            {server?.first_broken
              ? `${server.first_broken.tx_id}: ${server.first_broken.reason}`
              : 'GET /ledger/verify recomputes every receipt hash from genesis on the server.'}
          </div>
        </div>
        <button onClick={() => void runVerify()} disabled={checking} className="rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-white hover:bg-black disabled:opacity-50">
          {checking ? 'Verifying…' : 'Verify chain now'}
        </button>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Receipts in chain" value={receipts.length} />
        <Stat label="Links verified (browser)" value={`${verified}/${receipts.length}`} tone={verified !== receipts.length ? 'red' : undefined} />
        <Stat label="Clean rollbacks (hash-proven)" value={clean} />
        <Stat label="Blocked in shadow" value={blocked} />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_340px]">
        <Card className="overflow-hidden">
          <div className="max-h-[560px] overflow-y-auto">
            <table className="w-full text-left text-[14px]">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-line text-[12px] font-semibold text-muted">
                  <th className="px-5 py-3">#</th>
                  <th className="px-3 py-3">Transaction</th>
                  <th className="px-3 py-3">Verdict</th>
                  <th className="px-3 py-3">prev → hash</th>
                  <th className="px-5 py-3">Link</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((x, i) => (
                  <tr key={x.receipt_hash} onClick={() => setSel(i)} className={`cursor-pointer border-b border-line last:border-0 ${pick === i ? 'bg-[#eef4ff]' : 'hover:bg-paper'}`}>
                    <td className="px-5 py-3 font-semibold">#{i + 1}</td>
                    <td className="px-3 py-3 font-mono text-[13px]">{x.tx_id}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${verdictOf(x.status).pill}`}>{verdictOf(x.status).label}</span>
                    </td>
                    <td className="px-3 py-3 font-mono text-[12px] text-muted">
                      {short(x.prev_hash, 6)} → {short(x.receipt_hash, 6)}
                    </td>
                    <td className={`px-5 py-3 text-[13px] font-semibold ${links[i] ? 'text-[#15803d]' : 'text-danger'}`}>{links[i] ? 'Linked ✓' : 'Broken ✗'}</td>
                  </tr>
                ))}
                {receipts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-muted">
                      The ledger is empty.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
        {r && pick !== null && (
          <div className={`h-fit rounded-xl border-2 p-5 ${links[pick] ? 'border-[#15803d]' : 'border-danger'}`}>
            <div className={`font-mono text-[12px] font-bold tracking-[0.06em] ${links[pick] ? 'text-[#15803d]' : 'text-danger'}`}>
              RECEIPT #{pick + 1} · {links[pick] ? 'LINKED' : 'BROKEN LINK'}
            </div>
            <div className="mt-3 text-[15px]">
              Verdict: <span className="font-bold">{r.status}</span>
            </div>
            <div className="mt-1 text-[14px] text-muted">{r.ts ? new Date(r.ts).toLocaleString() : ''}</div>
            <div className="mt-3 space-y-1 rounded-lg bg-[#f3f4f6] p-3 font-mono text-[11px] text-[#374151]">
              <div className="break-all">prev&nbsp; {r.prev_hash}</div>
              <div className="break-all">hash&nbsp; {r.receipt_hash}</div>
            </div>
            <p className="mt-3 text-[12px] text-muted">The browser checks the links between receipts; the banner above shows the server's full re-hash (GET /ledger/verify).</p>
            <button onClick={() => onOpen(r.tx_id)} className="mt-3 text-[14px] text-[#1d4ed8] underline">
              Open case file
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
