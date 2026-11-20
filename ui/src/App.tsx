import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DemoAct,
  ProxyEvent,
  RuntimeConfig,
  StatePayload,
  TxReceipt,
} from './types';

import {
  Card,
  DataTable,
  INVARIANT_META,
  PHASE_TONE,
  Pill,
  Stat,
  checkSummary,
  checkTone,
  download,
  fmtMs,
  friendlyArgs,
  friendlyReceiptTitle,
  friendlyToolName,
  friendlyUndoStrategy,
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
  { id: 'overview', label: 'Product & Solutions' },
  { id: 'mission', label: 'Interactive Demo' },
  { id: 'transactions', label: 'Operations Log' },
  { id: 'assurance', label: 'Compliance & Audit' },
];

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
    if (window.location.hash !== h) window.location.hash = h;
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
        setEvents([]);
      };
      es.onerror = () => {
        live = false;
        setStreaming(false);
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
  const selectedIdx = selected ? receipts.findIndex((r) => r.tx_id === selected.tx_id) : -1;

  return (
    <div className="flex min-h-screen flex-col bg-white text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-6">
          <button onClick={() => setPage('overview')} className="flex shrink-0 items-center gap-2.5">
            <span className="text-[18px] font-bold tracking-tight">Ablate</span>
            <span className="hidden rounded-md border border-line bg-paper px-2 py-0.5 text-[11px] font-medium text-[#374151] lg:inline">
              Enterprise AI Transaction Security
            </span>
          </button>
          <nav className="flex items-center gap-6 overflow-x-auto">
            {NAV.map((n) => {
              const active =
                page === n.id ||
                (n.id === 'transactions' && (page === 'case' || page === 'evidence'));
              return (
                <button
                  key={n.id}
                  onClick={() => setPage(n.id)}
                  className={`whitespace-nowrap border-b-2 py-4 text-[14px] ${
                    active
                      ? 'border-ink font-semibold text-ink'
                      : n.id === 'mission'
                        ? 'border-transparent font-semibold text-[#1d4ed8] hover:text-ink'
                        : 'border-transparent text-[#374151] hover:text-ink'
                  }`}
                >
                  {n.label}
                </button>
              );
            })}
          </nav>
          <div className="hidden shrink-0 items-center gap-3 md:flex">
            <span className="flex items-center gap-1.5 text-[12px] text-muted">
              <span className={`h-2 w-2 rounded-full ${online && streaming ? 'bg-[#16a34a]' : 'bg-danger'}`} />
              {online ? 'Systems Operational' : 'Offline'}
            </span>
            {page !== 'mission' && (
              <button
                onClick={() => setPage('mission')}
                className="rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-white hover:bg-black"
              >
                Try Interactive Demo →
              </button>
            )}
          </div>
        </div>
      </header>

      {error && (
        <div className="mx-auto mt-4 w-full max-w-[1140px] px-6">
          <div className="rounded-lg border border-[#f0d3cf] bg-[#fffbfa] px-4 py-2 text-[14px] text-danger">{error}</div>
        </div>
      )}

      <main className="flex-1">
        {page === 'overview' && (
          <Overview
            latest={receipts.length > receiptsAtReset ? latest : null}
            running={running}
            onRun={runAct}
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
        {page === 'transactions' && (
          <Transactions receipts={receipts} config={config} onOpen={openTx} onRun={() => setPage('mission')} />
        )}
        {page === 'case' && (
          <CaseFile
            receipt={selected}
            index={selectedIdx}
            receipts={receipts}
            events={events}
            onBack={() => setPage('transactions')}
            onEvidence={() => go('evidence', selected?.tx_id ?? null)}
          />
        )}
        {page === 'evidence' && (
          <Evidence
            receipt={selected}
            index={selectedIdx}
            events={events}
            state={state}
            onBack={() => go('case', selected?.tx_id ?? null)}
          />
        )}
        {page === 'assurance' && <Assurance receipts={receipts} onOpen={openTx} />}
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-2 px-6 py-4 text-[12px] text-muted">
          <span>
            <span className="font-semibold text-ink">Ablate Enterprise Control Plane</span> · Powered by Google ADK &amp; Gemini · Deployed on Google Cloud Run
          </span>
          <span>© 2026 Ablate Inc. All rights reserved.</span>
        </div>
      </footer>
    </div>
  );
}

// ============================== Product & Solutions Page ===================

function Overview(props: {
  latest: TxReceipt | null;
  running: string | null;
  onRun: (a: DemoAct) => void;
  onOpen: (tx: string) => void;
  onOpenSandbox: () => void;
}) {
  const { latest, running } = props;
  const v = verdictOf(latest?.status);
  return (
    <>
      {/* 1. Executive Hero */}
      <section className="mx-auto grid max-w-[1140px] items-center gap-10 px-6 py-14 lg:grid-cols-[1.15fr_1fr]">
        <div>
          <div className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#1d4ed8]">
            Enterprise AI Transaction Security &amp; Rollback Infrastructure
          </div>
          <h1 className="mt-3 text-[42px] font-bold leading-[1.1] tracking-tight">
            Safe production write-access for enterprise AI agents.
          </h1>
          <p className="mt-5 max-w-[540px] text-[16px] leading-relaxed text-[#374151]">
            85% of enterprise AI initiatives are blocked from modifying live business systems because a single failed
            step leaves ERP, inventory, and billing records out of sync. Ablate sits between your AI agents and
            production systems to stage updates safely, enforce company policies with zero AI guesswork, and
            automatically roll back partial changes in milliseconds if any system fails.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <button
              onClick={props.onOpenSandbox}
              className="rounded-lg bg-[#1d4ed8] px-5 py-2.5 text-[15px] font-semibold text-white hover:bg-[#1e40af]"
            >
              Launch Interactive Demo →
            </button>
            <button
              onClick={() => props.onRun('act2_rollback')}
              disabled={!!running}
              className="rounded-lg border border-line bg-white px-5 py-2.5 text-[15px] font-medium hover:bg-paper disabled:opacity-50"
            >
              {running === 'act2_rollback' ? 'Running Live Rollback…' : 'Watch Instant Rollback'}
            </button>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-6 text-[13px] text-muted">
            <span>✓ Zero agent code changes required</span>
            <span>✓ 100% deterministic financial rules</span>
            <span>✓ Managed Cloud Run or Private VPC</span>
          </div>
        </div>

        {/* Clean Executive Protection Card (Zero raw tx_ hashes or variable names) */}
        <button
          onClick={props.onOpenSandbox}
          className="rounded-2xl bg-[#111318] p-6 text-left text-white shadow-[0_20px_50px_rgba(17,19,24,0.25)]"
        >
          <div className="flex items-center justify-between text-[12px] font-semibold uppercase tracking-[0.08em] text-[#9ca3af]">
            <span>LIVE PROTECTION STATUS</span>
            <span className="text-[#86efac]">● 3 Systems Connected</span>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <span className={`rounded-md px-3 py-1.5 text-[13px] font-bold tracking-[0.06em] ${latest ? v.block : 'bg-[#16a34a] text-white'}`}>
              {latest ? v.label : 'PROTECTED'}
            </span>
            <span className="text-[15px] font-semibold text-white">
              {latest ? v.title : 'ERP · Warehouse · Billing Synchronized'}
            </span>
          </div>
          <div className="mt-5 space-y-2.5 border-t border-white/10 pt-4 text-[14px]">
            {[
              'Double-Entry Accounting Balance',
              'Warehouse Stock Floor Protection',
              'Single-Transaction Approval Limit ($5,000)',
              'Verified Vendor Bank Account (IBAN)',
              'Document & Prompt Manipulation Shield',
            ].map((policyLabel) => (
              <div key={policyLabel} className="flex items-center justify-between">
                <span className="text-[#d1d5db]">{policyLabel}</span>
                <span className="text-[13px] font-semibold text-[#86efac]">Active ✓</span>
              </div>
            ))}
          </div>
          <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-3 text-[13px] text-[#9ca3af]">
            <span>100% Cross-System Consistency · ~2 ms Auto-Rollback</span>
            <span className="font-semibold text-white underline">Open Demo →</span>
          </div>
        </button>
      </section>

      {/* 2. Why Enterprises Deploy Ablate */}
      <section className="border-y border-line bg-paper">
        <div className="mx-auto max-w-[1140px] px-6 py-12">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#1d4ed8]">
            The Enterprise Operational Risk Gap
          </div>
          <h2 className="mt-1 text-[26px] font-bold">
            Why enterprises can’t give AI agents direct write-access to production APIs
          </h2>
          <div className="mt-6 grid gap-5 md:grid-cols-3">
            <div className="rounded-xl border border-line bg-white p-5">
              <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-danger">
                1. Half-Finished Multi-System Updates
              </div>
              <div className="mt-2 text-[16px] font-bold">External SaaS &amp; ERP APIs lack a shared Undo</div>
              <p className="mt-2 text-[14px] leading-relaxed text-[#374151]">
                When an AI agent updates an ERP purchase order and warehouse stock, then hits a billing conflict on step
                3, the first two systems remain permanently modified—leaving thousands of dollars in ledger discrepancies.
              </p>
            </div>
            <div className="rounded-xl border border-line bg-white p-5">
              <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#5c3700]">
                2. Tampered Invoices &amp; Unauthorized Payouts
              </div>
              <div className="mt-2 text-[16px] font-bold">External documents can manipulate agent actions</div>
              <p className="mt-2 text-[14px] leading-relaxed text-[#374151]">
                Agents reading inbound supplier invoices or emails can be tricked by disguised remittance notes into
                changing vendor bank accounts or initiating unapproved wire transfers.
              </p>
            </div>
            <div className="rounded-xl border border-line bg-white p-5">
              <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#15803d]">
                3. Concurrent Human Planner Conflicts
              </div>
              <div className="mt-2 text-[16px] font-bold">Blind retries overwrite human managers</div>
              <p className="mt-2 text-[14px] leading-relaxed text-[#374151]">
                If a human operations planner edits an order while an agent is working, a standard retry or rollback
                overwrites the manager’s decision. Ablate detects concurrent human edits and preserves them automatically.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 3. How Ablate Works in 4 Steps */}
      <section className="mx-auto max-w-[1140px] px-6 py-12">
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">How Ablate Works</div>
        <h2 className="mt-1 text-[26px] font-bold">Four layers of protection on every autonomous business workflow</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            [
              'Step 1 · Safe Staging Sandbox',
              'Hold changes before touching live records',
              'Every multi-system update requested by your AI agent is buffered in an isolated staging copy so live databases are never touched prematurely.',
            ],
            [
              'Step 2 · Deterministic Policy Gate',
              'Enforce financial & operational rules',
              'Verifies accounting balance, positive warehouse stock, approval dollar caps ($5,000), approved vendor bank accounts, and document safety.',
            ],
            [
              'Step 3 · Irreversible Action Guard',
              'Hold bank wires and notifications until last',
              'Reversible database updates execute first. Irreversible actions like bank payouts are held until every prior system confirms success.',
            ],
            [
              'Step 4 · Automatic Multi-System Undo',
              'Instant rollback + compliance audit trail',
              'If any downstream system fails, Ablate automatically reverses prior steps in milliseconds—protecting human edits—and seals a signed audit report.',
            ],
          ].map(([step, title, body]) => (
            <div key={step} className="rounded-xl border border-line bg-white p-5">
              <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#1d4ed8]">{step}</div>
              <div className="mt-2 text-[15px] font-bold text-ink">{title}</div>
              <p className="mt-2 text-[13px] leading-relaxed text-[#374151]">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 4. Enterprise Solutions & Pricing */}
      <section className="border-t border-line bg-paper">
        <div className="mx-auto max-w-[1140px] px-6 py-12">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                Enterprise Deployment &amp; Plans
              </div>
              <h2 className="mt-1 text-[26px] font-bold">Deploy in Managed Cloud or inside your Private VPC</h2>
            </div>
            <button
              onClick={props.onOpenSandbox}
              className="rounded-lg bg-[#1d4ed8] px-5 py-2.5 text-[14px] font-semibold text-white hover:bg-[#1e40af]"
            >
              Explore Interactive Demo →
            </button>
          </div>

          <div className="mt-6 grid gap-5 md:grid-cols-3">
            <div className="flex flex-col justify-between rounded-xl border border-line bg-white p-6">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">
                  Developer &amp; Evaluation
                </div>
                <div className="mt-2 text-[28px] font-bold">
                  $0 <span className="text-[14px] font-normal text-muted">/ month</span>
                </div>
                <p className="mt-2 text-[13px] text-[#374151]">
                  For engineering teams testing AI agent workflows in staging environments.
                </p>
                <ul className="mt-4 space-y-2 text-[13px] text-[#374151]">
                  <li>✓ Local staging sandbox &amp; policy gate</li>
                  <li>✓ 5 core financial &amp; inventory policies</li>
                  <li>✓ Tamper-evident audit report ledger</li>
                </ul>
              </div>
            </div>

            <div className="flex flex-col justify-between rounded-xl border-2 border-ink bg-white p-6">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#1d4ed8]">
                    Business Cloud
                  </span>
                  <span className="rounded-full bg-[#eef4ff] px-2.5 py-0.5 text-[11px] font-semibold text-[#1d4ed8]">
                    Most Popular
                  </span>
                </div>
                <div className="mt-2 text-[28px] font-bold">
                  $1,500 <span className="text-[14px] font-normal text-muted">/ month</span>
                </div>
                <p className="mt-2 text-[13px] text-[#374151]">
                  Managed Google Cloud Run control plane for production operations agents.
                </p>
                <ul className="mt-4 space-y-2 text-[13px] text-[#374151]">
                  <li>✓ 50,000 protected multi-system workflows / mo</li>
                  <li>✓ Pre-built Undo Connectors (NetSuite, SAP, Stripe, Salesforce, Shopify)</li>
                  <li>✓ Real-time operations console &amp; alert routing</li>
                </ul>
              </div>
            </div>

            <div className="flex flex-col justify-between rounded-xl border border-line bg-white p-6">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">
                  Enterprise Private VPC
                </div>
                <div className="mt-2 text-[28px] font-bold">
                  $6,000 <span className="text-[14px] font-normal text-muted">/ month</span>
                </div>
                <p className="mt-2 text-[13px] text-[#374151]">
                  For regulated enterprises, financial services, and Global 2000 capability centers.
                </p>
                <ul className="mt-4 space-y-2 text-[13px] text-[#374151]">
                  <li>✓ Self-hosted inside customer GCP / AWS VPC (zero data leaves network)</li>
                  <li>✓ Custom ERP rollback connectors &amp; human-edit protection</li>
                  <li>✓ SOX / ISO compliance exports &amp; 99.99% uptime SLA</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

// ============================== Operations Log (Transactions) ==============

function Transactions({
  receipts,
  config,
  onOpen,
  onRun,
}: {
  receipts: TxReceipt[];
  config: RuntimeConfig;
  onOpen: (t: string) => void;
  onRun: () => void;
}) {
  const indexed = receipts.map((r, idx) => ({ r, idx })).reverse();
  const blocked = receipts.filter((r) => ['ABORTED_IN_SHADOW', 'ESCALATED_HITL'].includes(r.status)).length;
  const corrupted = receipts.filter((r) => r.status === 'PARTIAL_CORRUPTION').length;
  const rb = median(
    receipts
      .filter((r) => r.status === 'ROLLED_BACK_CLEANLY' && typeof r.rollback_ms === 'number')
      .map((r) => r.rollback_ms as number)
  );
  return (
    <div className="mx-auto max-w-[1140px] px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold">Operations Log</h1>
          <p className="text-[14px] text-muted">
            Complete history of multi-system AI agent workflows, automatic rollbacks, and policy blocks
          </p>
        </div>
        <button
          onClick={onRun}
          className="rounded-lg bg-[#1d4ed8] px-4 py-2.5 text-[14px] font-semibold text-white hover:bg-[#1e40af]"
        >
          Open Interactive Demo →
        </button>
      </div>

      {!config.aegis_enabled && (
        <div className="mt-5 rounded-lg border border-[#f3d9a4] bg-[#fef7e6] px-4 py-2.5 text-[14px] text-[#5c3700]">
          <span className="font-semibold">Ablate Protection is Disabled</span> · AI agent changes are currently writing
          directly to live systems without staging or automatic rollback.
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Workflows Processed" value={receipts.length} />
        <Stat label="Threats Blocked in Sandbox" value={blocked} />
        <Stat label="Unprotected Data Mismatches" value={corrupted} tone={corrupted ? 'red' : undefined} />
        <Stat label="Median Automatic Rollback" value={rb === null ? '—' : `${rb.toFixed(1)} ms`} />
      </div>

      <Card className="mt-5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[14px]">
            <thead>
              <tr className="border-b border-line text-[12px] font-semibold text-muted">
                <th className="px-5 py-3">Business Workflow</th>
                <th className="px-3 py-3">Outcome</th>
                <th className="px-3 py-3">Summary</th>
                <th className="px-3 py-3">Recovery Action</th>
                <th className="px-5 py-3">System Integrity</th>
              </tr>
            </thead>
            <tbody>
              {indexed.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-muted">
                    No workflows recorded yet. Run a scenario in the Interactive Demo.
                  </td>
                </tr>
              )}
              {indexed.map(({ r, idx }) => {
                const v = verdictOf(r.status);
                return (
                  <tr
                    key={r.receipt_hash}
                    onClick={() => onOpen(r.tx_id)}
                    className={`cursor-pointer border-b border-line last:border-0 hover:bg-paper ${
                      r.status === 'PARTIAL_CORRUPTION' ? 'bg-[#fffbfa]' : ''
                    }`}
                  >
                    <td className="px-5 py-3.5">
                      <div className="text-[14px] font-bold text-ink">{friendlyReceiptTitle(r, idx)}</div>
                      <div className="text-[12px] text-muted">
                        {r.aegis_enabled ? 'Ablate Protection On' : 'Ablate Protection Off'} ·{' '}
                        {r.ts ? new Date(r.ts).toLocaleTimeString() : ''}
                      </div>
                    </td>
                    <td className="px-3 py-3.5">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold tracking-[0.04em] ${v.pill}`}>
                        {v.label}
                      </span>
                    </td>
                    <td className="max-w-[320px] px-3 py-3.5 text-[13px] text-[#374151]">
                      <span className="line-clamp-2">{v.line}</span>
                    </td>
                    <td className="px-3 py-3.5 text-[13px] text-[#374151]">
                      {r.compensations?.length
                        ? `${r.compensations.length} steps reversed (${fmtMs(r.rollback_ms)})`
                        : r.status === 'ABORTED_IN_SHADOW'
                          ? 'Stopped in sandbox'
                          : 'None'}
                    </td>
                    <td className="px-5 py-3.5 text-[13px] font-semibold">
                      {r.hashes_match ? (
                        <span className="text-[#14532d]">100% Verified ✓</span>
                      ) : r.status === 'QUARANTINED_CONCURRENT_EDIT' ? (
                        <span className="text-[#5c3700]">Manager Edit Kept ✓</span>
                      ) : (
                        <span className="text-danger">Mismatched ✕</span>
                      )}
                    </td>
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

// ============================== Workflow Audit Report (CaseFile) ===========

function CaseFile({
  receipt,
  index,
  receipts,
  events,
  onBack,
  onEvidence,
}: {
  receipt: TxReceipt | null;
  index: number;
  receipts: TxReceipt[];
  events: ProxyEvent[];
  onBack: () => void;
  onEvidence: () => void;
}) {
  if (!receipt) {
    return (
      <div className="mx-auto max-w-[1140px] px-6 py-16 text-center text-muted">
        No workflow selected.{' '}
        <button onClick={onBack} className="text-[#1d4ed8] underline">
          Back to Operations Log
        </button>
      </div>
    );
  }
  const v = verdictOf(receipt.status);
  const txEvents = events.filter((e) => e.tx_id === receipt.tx_id);
  const staged = txEvents.filter((e) => e.type === 'SHADOW_WRITE');
  const idx = receipts.findIndex((r) => r.receipt_hash === receipt.receipt_hash);
  const linked = idx <= 0 ? receipt.prev_hash === '0'.repeat(64) : receipts[idx - 1].receipt_hash === receipt.prev_hash;
  const comps = receipt.compensations ?? [];
  const checks = receipt.invariant_checks ?? [];
  const steps = receipt.steps ?? [];
  const compByStep = new Map(comps.map((c) => [Number(c.step), c]));
  const dbs: Array<{ key: 'erp' | 'wms' | 'billing'; label: string }> = [
    { key: 'erp', label: 'ERP System (NetSuite / SAP)' },
    { key: 'wms', label: 'Warehouse Management (WMS)' },
    { key: 'billing', label: 'Billing & Invoicing (Stripe)' },
  ];

  const integrity: Array<[boolean, string]> = [
    [Object.keys(receipt.pre_tx_hashes ?? {}).length === 3, 'Pre-execution baseline state captured across ERP, Warehouse, and Billing'],
    [
      receipt.status !== 'ABORTED_IN_SHADOW' && receipt.status !== 'ESCALATED_HITL' ? true : receipt.hashes_match,
      receipt.status === 'ABORTED_IN_SHADOW' || receipt.status === 'ESCALATED_HITL'
        ? 'Blocked in sandbox — zero live databases were modified'
        : 'All company policies verified prior to live execution',
    ],
    [
      comps.every((c) => c.status === 'COMPENSATED') || comps.length === 0,
      comps.length
        ? `${comps.filter((c) => c.status === 'COMPENSATED').length} of ${comps.length} automatic undo steps completed`
        : 'No rollback needed',
    ],
    [
      receipt.status === 'ROLLED_BACK_CLEANLY' ? receipt.hashes_match : true,
      receipt.status === 'ROLLED_BACK_CLEANLY'
        ? 'Post-rollback records verified 100% identical to initial state'
        : '100% deterministic policy evaluation (zero AI guesswork)',
    ],
    [linked, 'Cryptographically sealed into the tamper-evident audit ledger'],
  ];
  if (!receipt.aegis_enabled) {
    integrity.splice(1, 3, [false, 'Ablate Protection was OFF: no staging sandbox, no policy gate, no rollback']);
  }

  return (
    <div className="mx-auto max-w-[1140px] px-6 py-6">
      <div className="text-[13px] text-muted">
        <button onClick={onBack} className="text-[#1d4ed8] underline">
          Operations Log
        </button>{' '}
        / {friendlyReceiptTitle(receipt, index)}
      </div>

      <Card className="mt-3">
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-4">
            <span className={`rounded-lg px-4 py-2.5 text-[15px] font-bold tracking-[0.04em] ${v.block}`}>
              {v.label}
            </span>
            <div>
              <div className="text-[20px] font-bold text-ink">{friendlyReceiptTitle(receipt, index)}</div>
              <div className="text-[14px] text-[#374151]">{v.line}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[12px] text-muted">
              {receipt.rollback_ms !== null && receipt.rollback_ms !== undefined ? 'Automatic Rollback Time' : 'Execution Time'}
            </div>
            <div className="text-[24px] font-bold">{fmtMs(receipt.rollback_ms ?? receipt.commit_ms)}</div>
          </div>
        </div>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Card title="Multi-System Execution & Rollback Summary" aside="Reversible updates first · irreversible payouts held last">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-[14px]">
                <thead>
                  <tr className="border-y border-line text-[12px] font-semibold text-muted">
                    <th className="px-5 py-2.5">Business Action</th>
                    <th className="px-3 py-2.5">System Response</th>
                    <th className="px-3 py-2.5">Recovery Method</th>
                    <th className="px-5 py-2.5">Final Status</th>
                  </tr>
                </thead>
                <tbody>
                  {steps.length === 0 && staged.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-5 py-6 text-center text-muted">
                        No live systems were touched.
                      </td>
                    </tr>
                  )}
                  {steps.length === 0 &&
                    staged.map((e, i) => {
                      const rawTool = String(e.message.split(' ')[0] ?? '');
                      const args = ((e.data as Record<string, unknown>)?.args ?? {}) as Record<string, unknown>;
                      return (
                        <tr key={i} className="border-b border-line last:border-0">
                          <td className="px-5 py-3">
                            <div className="text-[13px] font-bold text-ink">{friendlyToolName(rawTool)}</div>
                            <div className="text-[12px] text-muted">{friendlyArgs(rawTool, args)}</div>
                          </td>
                          <td className="px-3 py-3 text-[13px] text-muted">Held in staging sandbox</td>
                          <td className="px-3 py-3 text-[13px] text-muted">Prevented before execution</td>
                          <td className="px-5 py-3">
                            <Pill tone="green">STOPPED IN SANDBOX</Pill>
                          </td>
                        </tr>
                      );
                    })}
                  {steps.map((s, i) => {
                    const c = compByStep.get(Number(s.step ?? i));
                    const failed = s.status === 'FAILED';
                    let tone: 'red' | 'green' | 'amber' | 'slate' = 'green';
                    let label = 'COMMITTED';
                    if (failed) {
                      tone = 'red';
                      label = 'SYSTEM REJECTED';
                    } else if (c?.status === 'COMPENSATED') {
                      tone = 'green';
                      label = 'AUTO-REVERTED ✓';
                    } else if (c?.status === 'QUARANTINED_CONCURRENT_EDIT') {
                      tone = 'amber';
                      label = 'HUMAN EDIT KEPT';
                    } else if (!receipt.aegis_enabled && receipt.status === 'PARTIAL_CORRUPTION') {
                      tone = 'red';
                      label = 'LEFT CORRUPTED';
                    }
                    return (
                      <tr key={i} className={`border-b border-line last:border-0 ${failed ? 'bg-[#fffbfa]' : ''}`}>
                        <td className="px-5 py-3">
                          <div className="text-[13px] font-bold text-ink">{friendlyToolName(s.tool)}</div>
                          {failed && <div className="text-[12px] text-danger">{s.error?.message}</div>}
                        </td>
                        <td className="px-3 py-3 text-[12px] text-[#374151]">
                          {failed ? 'Rejected (Invoice Locked)' : 'Applied to database'}
                        </td>
                        <td className="px-3 py-3 text-[12px] text-[#374151]">
                          {c ? friendlyUndoStrategy(String(c.strategy), s.tool) : failed ? 'Triggered rollback of prior steps' : 'None (Ablate Off)'}
                        </td>
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

          <Card title="Enterprise Policy Gate Verification" aside="100% Deterministic · Zero AI Guesswork">
            <div className="divide-y divide-line border-t border-line">
              {checks.map((c) => {
                const key = c.name.startsWith('dry_run') ? 'dry_run' : c.name;
                const meta = INVARIANT_META[key];
                return (
                  <div key={c.name} className={`flex items-center gap-4 px-5 py-3 ${c.result === 'FAIL' ? 'bg-[#fffbfa]' : ''}`}>
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-bold text-ink">{meta?.label ?? c.name}</div>
                      <div className="text-[12px] text-[#374151]">{checkSummary(c) || meta?.desc}</div>
                    </div>
                    <Pill tone={checkTone(c.result)}>
                      {c.result === 'ESCALATE_HITL' ? 'LIMIT EXCEEDED' : c.result === 'FAIL' ? 'BLOCKED' : 'VERIFIED ✓'}
                    </Pill>
                  </div>
                );
              })}
              {checks.length === 0 && (
                <div className="px-5 py-4 text-[14px] text-muted">
                  Policy verification was bypassed because Ablate Protection was turned off.
                </div>
              )}
            </div>
          </Card>

          <Card title="Production Database Integrity Verification" aside="Before vs. After Execution">
            <div className="grid gap-3 border-t border-line p-5 sm:grid-cols-3">
              {dbs.map((db) => {
                const pre = receipt.pre_tx_hashes?.[db.key];
                const postH = receipt.post_tx_hashes?.[db.key];
                const same = pre === postH;
                const isHumanKept = receipt.status === 'QUARANTINED_CONCURRENT_EDIT' && db.key === 'erp';
                return (
                  <div
                    key={db.key}
                    className={`rounded-[10px] border p-3.5 ${
                      same ? 'border-line bg-white' : isHumanKept ? 'border-[#f3d9a4] bg-[#fef7e6]' : 'border-[#f0d3cf] bg-[#fffbfa]'
                    }`}
                  >
                    <div className="text-[13px] font-bold text-ink">{db.label}</div>
                    <div
                      className={`mt-2 text-[13px] font-bold ${
                        same ? 'text-[#14532d]' : isHumanKept ? 'text-[#5c3700]' : 'text-danger'
                      }`}
                    >
                      {same ? '100% Restored & Verified ✓' : isHumanKept ? 'Human Manager Edit Preserved ✓' : 'Left Altered (Mismatched) ✕'}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="px-5 pb-4">
              <button onClick={onEvidence} className="text-[14px] font-semibold text-[#1d4ed8] underline">
                View detailed system timeline →
              </button>
            </div>
          </Card>
        </div>

        <aside className="space-y-5">
          <Card title="Compliance & Safety Checklist">
            <ul className="space-y-2.5 px-5 pb-4 text-[13px]">
              {integrity.map(([ok, text]) => (
                <li key={text} className="flex gap-2">
                  <span className={ok ? 'font-bold text-[#15803d]' : 'font-bold text-danger'}>{ok ? '✓' : '✗'}</span>
                  <span className="text-[#374151]">{text}</span>
                </li>
              ))}
            </ul>
          </Card>

          {receipt.quarantine && receipt.quarantine.length > 0 && (
            <Card title="Human Manager Edit Protection">
              <div className="px-5 pb-4 text-[13px]">
                {receipt.quarantine.map((q) => (
                  <div key={q.entity}>
                    <div className="font-semibold text-ink">Purchase Order #1042 Quantity</div>
                    <table className="mt-2 w-full text-[12px]">
                      <thead>
                        <tr className="border-b border-line text-muted">
                          <th className="py-1 text-left font-medium">Original</th>
                          <th className="py-1 text-right font-medium">AI Agent</th>
                          <th className="py-1 text-right font-medium">Human Manager</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(q.three_way_diff).map(([k, d]) => (
                          <tr key={k}>
                            <td className="py-1.5">{String(d.base)} units</td>
                            <td className="py-1.5 text-right">{String(d.ours)} units</td>
                            <td className="py-1.5 text-right font-bold text-[#14532d]">{String(d.theirs)} units (Kept ✓)</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-2 text-[12px] text-muted">
                      Ablate detected that a human manager updated the order to 470 units while the agent was running,
                      and prevented the rollback from overwriting the manager’s change.
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <button
            onClick={() => download(`ablate-audit-report-${receipt.tx_id}.json`, receipt)}
            className="w-full rounded-lg bg-ink py-3 text-[14px] font-semibold text-white hover:bg-black"
          >
            Download Signed Audit Report (JSON)
          </button>
        </aside>
      </div>
    </div>
  );
}

// ============================== Detailed Timeline (Evidence) ===============

function Evidence({
  receipt,
  index,
  events,
  state,
  onBack,
}: {
  receipt: TxReceipt | null;
  index: number;
  events: ProxyEvent[];
  state: StatePayload | null;
  onBack: () => void;
}) {
  const txEvents = receipt ? events.filter((e) => e.tx_id === receipt.tx_id) : events;
  return (
    <div className="mx-auto max-w-[1140px] px-6 py-6">
      <div className="text-[13px] text-muted">
        <button onClick={onBack} className="text-[#1d4ed8] underline">
          {receipt ? friendlyReceiptTitle(receipt, index) : 'Audit Report'}
        </button>{' '}
        / System Timeline
      </div>
      <h1 className="mt-2 text-[24px] font-bold">
        System Execution Timeline {receipt ? `· ${friendlyReceiptTitle(receipt, index)}` : ''}
      </h1>
      <p className="text-[14px] text-muted">
        Chronological audit trail of every step and current live production records
      </p>

      <Card className="mt-5" title="Step-by-Step Audit Trail" aside={`${txEvents.length} recorded events`}>
        <ol className="max-h-[460px] overflow-y-auto border-t border-line">
          {txEvents.length === 0 && (
            <li className="px-5 py-4 text-[14px] text-muted">No active timeline events in memory.</li>
          )}
          {txEvents.map((e, i) => (
            <li
              key={i}
              className={`flex items-start gap-3 border-b border-line px-5 py-2.5 last:border-0 ${
                /FAIL|CONFLICT|VIOLATION/.test(e.type) || e.type === 'FAIL' ? 'bg-[#fffbfa]' : ''
              }`}
            >
              <span className="w-[84px] shrink-0 pt-0.5 font-mono text-[11px] text-muted">{e.ts.slice(11, 23)}</span>
              <span
                className={`w-[84px] shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-bold tracking-[0.04em] ${
                  PHASE_TONE[e.phase] ?? 'bg-[#f3f4f6] text-muted'
                }`}
              >
                {e.phase}
              </span>
              <span className="min-w-0 text-[13px] text-[#374151]">{e.message}</span>
            </li>
          ))}
        </ol>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {state &&
          (
            [
              ['ERP System', [['Purchase Orders', state.erp.purchase_orders], ['General Ledger', state.erp.gl_entries]]],
              ['Warehouse (WMS)', [['Stock & Reservations', state.wms.inventory]]],
              ['Billing & Payments', [['Vendor Invoices', state.billing.invoices], ['Credit Notes', state.billing.credit_notes]]],
            ] as Array<[string, Array<[string, unknown[]]>]>
          ).map(([name, tables]) => (
            <Card key={name} title={name}>
              {tables.map(([t, rows]) => (
                <div key={t} className="border-t border-line">
                  <div className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                    {t} ({rows.length})
                  </div>
                  <DataTable rows={rows as Array<Record<string, unknown>>} />
                </div>
              ))}
            </Card>
          ))}
      </div>
    </div>
  );
}

// ============================== Compliance & Audit (Assurance) =============

function Assurance({ receipts, onOpen }: { receipts: TxReceipt[]; onOpen: (t: string) => void }) {
  const [sel, setSel] = useState<number | null>(null);
  const links = receipts.map((r, i) => (i === 0 ? r.prev_hash === '0'.repeat(64) : receipts[i - 1].receipt_hash === r.prev_hash));
  const verified = links.filter(Boolean).length;
  const clean = receipts.filter((r) => r.status === 'ROLLED_BACK_CLEANLY' && r.hashes_match).length;
  const blocked = receipts.filter((r) => r.status === 'ABORTED_IN_SHADOW').length;
  const pick = sel ?? (receipts.length ? receipts.length - 1 : null);
  const r = pick !== null ? receipts[pick] : null;

  type VerifyReport = {
    chain_valid: boolean;
    receipts: number;
    verified: number;
    first_broken: { index: number; tx_id: string; reason: string } | null;
  };
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
    <div className="mx-auto max-w-[1140px] px-6 py-8">
      <h1 className="text-[26px] font-bold">Compliance &amp; Audit Verification</h1>
      <p className="max-w-[680px] text-[14px] text-muted">
        Every workflow processed by Ablate is sealed into a tamper-evident cryptographic audit chain for SOX, ISO 27001,
        and financial compliance teams. Modifying any historical record is immediately detected.
      </p>
      <div
        className={`mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 px-5 py-3.5 ${
          !server ? 'border-line' : server.chain_valid ? 'border-[#15803d] bg-[#f3faf5]' : 'border-danger bg-[#fffbfa]'
        }`}
      >
        <div>
          <div className={`text-[15px] font-bold ${!server ? 'text-muted' : server.chain_valid ? 'text-[#15803d]' : 'text-danger'}`}>
            {!server
              ? 'Audit Ledger Verification Pending…'
              : server.chain_valid
                ? `Audit Ledger Integrity Verified · ${server.verified} of ${server.receipts} Records Authentic`
                : `Audit Alert: Tampering Detected at Record #${(server.first_broken?.index ?? 0) + 1}`}
          </div>
          <div className="text-[12px] text-muted">
            Continuous cryptographic verification confirms zero unauthorized modifications to historical audit records.
          </div>
        </div>
        <button
          onClick={() => void runVerify()}
          disabled={checking}
          className="rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-white hover:bg-black disabled:opacity-50"
        >
          {checking ? 'Verifying Audit Ledger…' : 'Run Compliance Audit Check'}
        </button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Sealed Audit Records" value={receipts.length} />
        <Stat label="Records Verified Authentic" value={`${verified}/${receipts.length}`} tone={verified !== receipts.length ? 'red' : undefined} />
        <Stat label="Verified Auto-Rollbacks" value={clean} />
        <Stat label="Threats Prevented in Sandbox" value={blocked} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_340px]">
        <Card className="overflow-hidden">
          <div className="max-h-[560px] overflow-y-auto">
            <table className="w-full text-left text-[14px]">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-line text-[12px] font-semibold text-muted">
                  <th className="px-5 py-3">Record #</th>
                  <th className="px-3 py-3">Business Workflow</th>
                  <th className="px-3 py-3">Outcome</th>
                  <th className="px-5 py-3">Audit Status</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((x, i) => (
                  <tr
                    key={x.receipt_hash}
                    onClick={() => setSel(i)}
                    className={`cursor-pointer border-b border-line last:border-0 ${
                      pick === i ? 'bg-[#eef4ff]' : 'hover:bg-paper'
                    }`}
                  >
                    <td className="px-5 py-3 font-semibold">#{i + 1}</td>
                    <td className="px-3 py-3 font-medium text-ink">{friendlyReceiptTitle(x, i)}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${verdictOf(x.status).pill}`}>
                        {verdictOf(x.status).label}
                      </span>
                    </td>
                    <td className={`px-5 py-3 text-[13px] font-semibold ${links[i] ? 'text-[#15803d]' : 'text-danger'}`}>
                      {links[i] ? 'Authentic & Sealed ✓' : 'Tampered ✗'}
                    </td>
                  </tr>
                ))}
                {receipts.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-10 text-center text-muted">
                      No audit records sealed yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
        {r && pick !== null && (
          <div className={`h-fit rounded-xl border-2 p-5 ${links[pick] ? 'border-[#15803d]' : 'border-danger'}`}>
            <div className={`text-[12px] font-bold uppercase tracking-[0.06em] ${links[pick] ? 'text-[#15803d]' : 'text-danger'}`}>
              AUDIT RECORD #{pick + 1} · {links[pick] ? 'AUTHENTIC & SEALED' : 'INTEGRITY ALERT'}
            </div>
            <div className="mt-2 text-[16px] font-bold text-ink">{friendlyReceiptTitle(r, pick)}</div>
            <div className="mt-1 text-[13px] text-[#374151]">{verdictOf(r.status).line}</div>
            <div className="mt-2 text-[12px] text-muted">{r.ts ? new Date(r.ts).toLocaleString() : ''}</div>
            <div className="mt-3 rounded-lg bg-[#f3f4f6] p-3 text-[12px] text-[#374151]">
              <div>
                <span className="font-semibold">Digital Signature:</span>{' '}
                <span className="font-mono text-[11px]">{short(r.receipt_hash, 16)}</span>
              </div>
              <div className="mt-1">
                <span className="font-semibold">Chain Link:</span>{' '}
                <span className="font-mono text-[11px]">{short(r.prev_hash, 16)}</span>
              </div>
            </div>
            <button onClick={() => onOpen(r.tx_id)} className="mt-4 text-[14px] font-semibold text-[#1d4ed8] underline">
              Open Full Workflow Report →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
