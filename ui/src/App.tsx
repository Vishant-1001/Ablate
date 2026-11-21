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
import LiveMcpGateway from './components/LiveMcpGateway';

const DEFAULT_API =
  typeof window !== 'undefined' && window.location.port !== '5173'
    ? window.location.origin
    : 'http://localhost:8000';
const API_BASE = (import.meta.env.VITE_API_URL || DEFAULT_API).replace(/\/+$/, '');

type Page = 'overview' | 'mission' | 'transactions' | 'case' | 'evidence' | 'assurance' | 'mcp';

const DEMO_TABS: Array<{ id: Page; label: string }> = [
  { id: 'mission', label: '1. Step-by-Step Simulator' },
  { id: 'transactions', label: '2. Activity Log & Reports' },
  { id: 'assurance', label: '3. Compliance & Audit Verification' },
  { id: 'mcp', label: '4. Live MCP Gateway' },
];

type Route = { page: Page; tx: string | null };
const PAGES: Page[] = ['overview', 'mission', 'transactions', 'case', 'evidence', 'assurance', 'mcp'];
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
  const inDemo = page !== 'overview';

  const [state, setState] = useState<StatePayload | null>(null);
  const [events, setEvents] = useState<ProxyEvent[]>([]);
  const [receipts, setReceipts] = useState<TxReceipt[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [stage, setStage] = useState<number>(1);
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
        const ev = JSON.parse((m as MessageEvent).data) as ProxyEvent;
        setEvents((prev) =>
          prev.some((p) => p.ts === ev.ts && p.type === ev.type && p.tx_id === ev.tx_id && p.message === ev.message)
            ? prev
            : [...prev, ev],
        );
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
        /* ignore */
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

  // Manual step-by-step control: loading a scenario starts at Step 1 and lets the user advance with Next / Previous.
  const runAct = async (act: DemoAct) => {
    setRunning(act);
    setError(null);
    go('mission', null);
    setStage(1);
    try {
      await post(`/demo/run/${act}`);
      const [ev] = await Promise.all([fetch(`${API_BASE}/events`), refresh()]);
      if (ev.ok) setEvents(((await ev.json()) as { events?: ProxyEvent[] }).events ?? []);
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
      setStage(0);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(null);
    }
  };

  const openTx = (txId: string) => go('case', txId);

  const scrollToSection = (id: string) => {
    if (page !== 'overview') {
      go('overview', null);
      window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }), 60);
    } else {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const latest = receipts.length ? receipts[receipts.length - 1] : null;
  const selected = receipts.find((r) => r.tx_id === selectedTx) ?? latest;
  const selectedIdx = selected ? receipts.findIndex((r) => r.tx_id === selected.tx_id) : -1;

  return (
    <div className="flex min-h-screen flex-col bg-white text-ink">
      {/* Professional Enterprise Header (Single Interactive Demo Button) */}
      <header className="sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-4 px-6">
          <button onClick={() => setPage('overview')} className="flex shrink-0 items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-ink text-[14px] font-bold text-white">
              A
            </span>
            <span className="text-[19px] font-bold tracking-tight text-ink">Ablate</span>
            <span className="hidden rounded-md border border-line bg-paper px-2 py-0.5 text-[11px] font-medium text-[#374151] lg:inline">
              Enterprise AI Transaction Security
            </span>
          </button>

          <nav className="hidden items-center gap-7 md:flex">
            {[
              ['solutions', 'Solutions'],
              ['deployment', 'Role-Based Deployment'],
              ['how-it-works', 'How It Works'],
              ['pricing', 'Pricing Comparison'],
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => scrollToSection(id)}
                className="text-[14px] font-medium text-[#374151] transition hover:text-ink"
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden items-center gap-1.5 text-[12px] text-muted sm:flex">
              <span className={`h-2 w-2 rounded-full ${online && streaming ? 'bg-[#16a34a]' : 'bg-danger'}`} />
              {online ? 'Systems Operational' : 'Offline'}
            </span>
            {inDemo ? (
              <button
                onClick={() => setPage('overview')}
                className="rounded-lg border border-line bg-white px-4 py-2 text-[13px] font-semibold text-ink hover:bg-paper"
              >
                ← Back to Product Site
              </button>
            ) : (
              <button
                onClick={() => setPage('mission')}
                className="rounded-lg bg-[#1d4ed8] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#1e40af]"
              >
                Interactive Demo →
              </button>
            )}
          </div>
        </div>

        {/* Sub-Navigation Bar INSIDE the Demo Workspace (Simulator | Activity Log | Compliance) */}
        {inDemo && (
          <div className="border-t border-line bg-paper">
            <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-6">
              <div className="flex items-center gap-6 overflow-x-auto">
                {DEMO_TABS.map((t) => {
                  const active =
                    page === t.id ||
                    (t.id === 'transactions' && (page === 'case' || page === 'evidence'));
                  return (
                    <button
                      key={t.id}
                      onClick={() => setPage(t.id)}
                      className={`whitespace-nowrap border-b-2 py-3 text-[13px] ${
                        active
                          ? 'border-[#1d4ed8] font-bold text-[#1d4ed8]'
                          : 'border-transparent font-medium text-[#374151] hover:text-ink'
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
              <span className="hidden text-[12px] text-muted lg:inline">
                Interactive Demo Environment · ERP, Warehouse &amp; Billing Sandbox
              </span>
            </div>
          </div>
        )}
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
            onScrollTo={scrollToSection}
          />
        )}
        {page === 'mission' && (
          <div className="mx-auto max-w-[1440px] px-4 py-5">
            <MissionControl
              events={events}
              receipts={receipts}
              state={state}
              config={config}
              running={running}
              stage={stage}
              onSetStage={(s) => setStage(s)}
              onRun={runAct}
              onConfig={setConfig}
              onReset={reset}
              onOpenTx={openTx}
            />
          </div>
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
        {page === 'mcp' && (
          <LiveMcpGateway apiBase={API_BASE} events={events} state={state} onRefresh={() => void refresh()} />
        )}
      </main>

      {/* Professional Enterprise Multi-Column Footer */}
      <footer className="border-t border-line bg-paper">
        <div className="mx-auto max-w-[1440px] px-6 py-10">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-ink text-[12px] font-bold text-white">
                  A
                </span>
                <span className="text-[16px] font-bold text-ink">Ablate</span>
              </div>
              <p className="mt-2.5 text-[13px] leading-relaxed text-[#374151]">
                Transactional staging, deterministic policy enforcement, and automatic multi-system rollback for
                enterprise AI agents.
              </p>
            </div>

            <div>
              <div className="text-[12px] font-bold uppercase tracking-[0.06em] text-ink">Platform Capabilities</div>
              <ul className="mt-2.5 space-y-1.5 text-[13px] text-[#374151]">
                <li>Safe Multi-System Staging Sandbox</li>
                <li>Deterministic Financial Policy Engine</li>
                <li>Automatic Reverse-Saga Rollback</li>
                <li>Human Planner Conflict Protection</li>
              </ul>
            </div>

            <div>
              <div className="text-[12px] font-bold uppercase tracking-[0.06em] text-ink">Enterprise Connectors</div>
              <ul className="mt-2.5 space-y-1.5 text-[13px] text-[#374151]">
                <li>NetSuite &amp; SAP ERP Systems</li>
                <li>Warehouse Management (WMS)</li>
                <li>Stripe, Tipalti &amp; AP Billing</li>
                <li>Google ADK &amp; MCP Standard</li>
              </ul>
            </div>

            <div>
              <div className="text-[12px] font-bold uppercase tracking-[0.06em] text-ink">Deployment &amp; Trust</div>
              <ul className="mt-2.5 space-y-1.5 text-[13px] text-[#374151]">
                <li>Google Cloud Run Managed Cloud</li>
                <li>Private VPC / Self-Hosted Container</li>
                <li>Cryptographic Audit Chain Reports</li>
                <li>SOX &amp; ISO 27001 Compliance Ready</li>
              </ul>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-5 text-[12px] text-muted">
            <span>© 2026 Ablate Inc. All rights reserved.</span>
            <span>Powered by Google Cloud Run, Google ADK &amp; Gemini</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ============================== Enterprise Website (Overview) ==============

function Overview(props: {
  latest: TxReceipt | null;
  onScrollTo: (id: string) => void;
}) {
  const { latest } = props;
  const v = verdictOf(latest?.status);
  return (
    <>
      {/* 1. Executive Hero (No duplicate Interactive Demo buttons) */}
      <section className="mx-auto grid max-w-[1140px] items-center gap-10 px-6 py-14 lg:grid-cols-[1.15fr_1fr]">
        <div>
          <div className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#1d4ed8]">
            Enterprise AI Transaction Security
          </div>
          <h1 className="mt-3 text-[40px] font-bold leading-[1.12] tracking-tight">
            An automatic undo button for your company’s AI agents.
          </h1>
          <p className="mt-4 max-w-[500px] text-[16px] leading-relaxed text-[#374151]">
            When an AI agent updates Orders, Inventory, and Billing, a single failed step leaves your databases out of
            sync. Ablate verifies your company rules first and automatically reverses partial updates if anything fails.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={() => props.onScrollTo('solutions')}
              className="rounded-lg bg-ink px-5 py-2.5 text-[14px] font-semibold text-white hover:bg-black"
            >
              Explore Enterprise Solutions
            </button>
            <button
              onClick={() => props.onScrollTo('pricing')}
              className="rounded-lg border border-line bg-white px-5 py-2.5 text-[14px] font-medium hover:bg-paper"
            >
              View Deployment Plans
            </button>
          </div>
          <div className="mt-7 grid grid-cols-3 gap-4 border-t border-line pt-5">
            <div>
              <div className="text-[22px] font-bold text-ink">100%</div>
              <div className="text-[12px] text-muted">Cross-System Consistency</div>
            </div>
            <div>
              <div className="text-[22px] font-bold text-ink">&lt; 20 ms</div>
              <div className="text-[12px] text-muted">Automatic Undo Speed</div>
            </div>
            <div>
              <div className="text-[22px] font-bold text-ink">0</div>
              <div className="text-[12px] text-muted">Agent Code Changes</div>
            </div>
          </div>
        </div>

        {/* Executive System Protection Card */}
        <div className="rounded-2xl bg-[#111318] p-6 text-left text-white shadow-[0_20px_50px_rgba(17,19,24,0.25)]">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9ca3af]">
            <span>ABLATE CONTROL PLANE</span>
            <span className="text-[#86efac]">● 3 Enterprise Systems Connected</span>
          </div>
          <div className="mt-3.5 flex items-center gap-3">
            <span className={`rounded-md px-3 py-1 text-[12px] font-bold ${latest ? v.block : 'bg-[#16a34a] text-white'}`}>
              {latest ? v.label : 'ACTIVE'}
            </span>
            <span className="text-[15px] font-semibold text-white">
              {latest ? v.title : 'Orders · Warehouse · Billing Protected'}
            </span>
          </div>
          <div className="mt-4 space-y-2 border-t border-white/10 pt-4 text-[13px]">
            {[
              'Double-Entry Accounting Balance',
              'Positive Warehouse Stock Floor',
              'Single-Transaction Approval Cap ($5,000)',
              'Approved Vendor Bank Account (IBAN)',
              'Tampered Invoice & Prompt Shield',
            ].map((policyLabel) => (
              <div key={policyLabel} className="flex items-center justify-between">
                <span className="text-[#d1d5db]">{policyLabel}</span>
                <span className="font-semibold text-[#86efac]">Enforced ✓</span>
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-white/10 pt-3 text-[12px] text-[#9ca3af]">
            Deterministic policy enforcement · Automatic multi-system rollback · Audit trail
          </div>
        </div>
      </section>

      {/* 2. Enterprise Solutions */}
      <section id="solutions" className="border-y border-line bg-paper">
        <div className="mx-auto max-w-[1140px] px-6 py-12">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#1d4ed8]">Enterprise Solutions</div>
          <h2 className="mt-1 text-[24px] font-bold">Three production risks eliminated automatically</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-line bg-white p-5">
              <div className="text-[11px] font-bold uppercase text-danger">01 · Mid-Flight API Failures</div>
              <div className="mt-1.5 text-[16px] font-bold">Automatic Multi-System Rollback</div>
              <p className="mt-1.5 text-[13px] text-[#374151]">
                If step 3 fails in Billing, Ablate automatically undoes steps 1 and 2 in Orders and Warehouse so your
                databases never diverge.
              </p>
            </div>
            <div className="rounded-xl border border-line bg-white p-5">
              <div className="text-[11px] font-bold uppercase text-[#5c3700]">02 · Unauthorized Payouts</div>
              <div className="mt-1.5 text-[16px] font-bold">Hard Financial &amp; Bank Rules</div>
              <p className="mt-1.5 text-[13px] text-[#374151]">
                Blocks tampered invoices or AI mistakes from exceeding dollar limits or sending funds to unapproved bank
                accounts.
              </p>
            </div>
            <div className="rounded-xl border border-line bg-white p-5">
              <div className="text-[11px] font-bold uppercase text-[#15803d]">03 · Human Manager Conflicts</div>
              <div className="mt-1.5 text-[16px] font-bold">Protects Concurrent Human Edits</div>
              <p className="mt-1.5 text-[13px] text-[#374151]">
                If a human manager updates an order while the AI is working, Ablate detects the manager’s edit and never
                overwrites it.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Role-Based Enterprise Adoption & Deployment (Dedicated High-Visibility Section) */}
      <section id="deployment" className="mx-auto max-w-[1140px] px-6 py-12">
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#1d4ed8]">
          Role-Based Enterprise Adoption
        </div>
        <h2 className="mt-1 text-[26px] font-bold text-ink">
          How each team in your enterprise deploys and operates Ablate
        </h2>
        <p className="mt-1.5 max-w-[680px] text-[14px] text-[#374151]">
          Ablate fits directly into your existing engineering, cloud infrastructure, and compliance workflows without
          requiring any changes to your AI agent prompts or application code.
        </p>

        <div className="mt-6 grid gap-5 md:grid-cols-3">
          <div className="flex flex-col justify-between rounded-xl border border-line bg-white p-5 shadow-sm">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#1d4ed8]">
                  01 · AI &amp; Application Engineers
                </span>
                <span className="rounded bg-[#eef4ff] px-2.5 py-0.5 font-mono text-[11px] font-bold text-[#1d4ed8]">
                  1-Line Proxy URL
                </span>
              </div>
              <div className="mt-2.5 text-[17px] font-bold text-ink">Drop-In MCP Endpoint (Zero Code Rewrites)</div>
              <p className="mt-2 text-[13px] leading-relaxed text-[#374151]">
                Point your Google ADK, LangGraph, or Claude agent’s MCP tool URL to Ablate instead of raw production
                APIs. Every tool call is automatically staged and protected at runtime.
              </p>
            </div>
            <div className="mt-4 rounded-lg border border-line bg-paper px-3 py-2.5 font-mono text-[11.5px] text-ink">
              MCP_URL = "https://tx.ablate.company.com/mcp"
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-line bg-white p-5 shadow-sm">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#15803d]">
                  02 · DevOps &amp; Cloud Security
                </span>
                <span className="rounded bg-[#e3f2e8] px-2.5 py-0.5 font-mono text-[11px] font-bold text-[#14532d]">
                  Cloud Run / Private VPC
                </span>
              </div>
              <div className="mt-2.5 text-[17px] font-bold text-ink">Managed Cloud or Self-Hosted VPC Container</div>
              <p className="mt-2 text-[13px] leading-relaxed text-[#374151]">
                Deploy in 2 minutes on Google Cloud Run or as a Docker/Helm container inside your Private VPC. Define
                pre-built ERP/Billing undo mappings and dollar caps in a declarative config file.
              </p>
            </div>
            <div className="mt-4 rounded-lg border border-line bg-paper px-3 py-2.5 font-mono text-[11.5px] text-ink">
              gcloud run deploy ablate --region asia-south1
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-line bg-white p-5 shadow-sm">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#5c3700]">
                  03 · Operations &amp; Compliance Teams
                </span>
                <span className="rounded bg-[#fbebc8] px-2.5 py-0.5 font-mono text-[11px] font-bold text-[#5c3700]">
                  Web Control Plane
                </span>
              </div>
              <div className="mt-2.5 text-[17px] font-bold text-ink">Live Operations Console &amp; Audit Exports</div>
              <p className="mt-2 text-[13px] leading-relaxed text-[#374151]">
                Monitor multi-system rollbacks in real time, approve transactions held above the $5,000 limit, review
                protected human manager edits, and export SHA-256 hash-chained logs for SOX &amp; ISO audits.
              </p>
            </div>
            <div className="mt-4 rounded-lg border border-line bg-paper px-3 py-2.5 font-mono text-[11.5px] text-ink">
              Activity Log · 3-Way Human Edit Diffs · SOX Export
            </div>
          </div>
        </div>
      </section>

      {/* 4. How It Works & Integrations */}
      <section id="how-it-works" className="border-t border-line bg-white">
        <div className="mx-auto max-w-[1140px] px-6 py-12">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">How It Works</div>
          <h2 className="mt-1 text-[24px] font-bold">Four steps on every autonomous transaction</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['01 · Stage in Sandbox', 'Holds proposed updates in memory before touching live records.'],
              ['02 · Verify 5 Policies', 'Enforces accounting, inventory, dollar cap, and bank IBAN rules.'],
              ['03 · Hold Payouts Last', 'Executes reversible updates first and holds irreversible wires until last.'],
              ['04 · Auto-Undo on Error', 'Reverses partial changes in milliseconds if any downstream system fails.'],
            ].map(([title, desc]) => (
              <div key={title} className="rounded-xl border border-line bg-paper/60 p-5">
                <div className="text-[14px] font-bold text-ink">{title}</div>
                <p className="mt-1.5 text-[13px] text-[#374151]">{desc}</p>
              </div>
            ))}
          </div>

          <div id="integrations" className="mt-8 rounded-xl border border-line bg-paper p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-[12px] font-bold uppercase tracking-[0.08em] text-[#1d4ed8]">
                  Drop-In Enterprise Compatibility
                </div>
                <div className="mt-0.5 text-[15px] font-bold text-ink">
                  Works with your existing AI frameworks and core business systems
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-[12px] font-semibold text-[#374151]">
                {['Google ADK', 'Gemini', 'MCP Standard', 'NetSuite ERP', 'SAP', 'Warehouse WMS', 'Stripe Billing'].map(
                  (tag) => (
                    <span key={tag} className="rounded-lg border border-line bg-white px-3 py-1">
                      {tag}
                    </span>
                  ),
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Side-by-Side Pricing & Feature Comparison Matrix */}
      <section id="pricing" className="border-t border-line bg-paper">
        <div className="mx-auto max-w-[1140px] px-6 py-12">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#1d4ed8]">
            Transparent Pricing &amp; Plan Comparison
          </div>
          <h2 className="mt-1 text-[26px] font-bold text-ink">
            Side-by-side plan comparison for engineering teams and enterprises
          </h2>
          <p className="mt-1 text-[14px] text-[#374151]">
            Zero per-seat fees and zero LLM token markup—because Ablate’s policy and rollback engine is 100%
            deterministic code.
          </p>

          {/* Side-by-Side Comparison Matrix Table */}
          <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] border-collapse text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-line bg-paper/70">
                    <th className="w-[31%] px-6 py-5 align-top">
                      <div className="text-[12px] font-bold uppercase tracking-[0.08em] text-muted">
                        Capability / Plan Tier
                      </div>
                      <div className="mt-2 text-[16px] font-bold text-ink">Compare Plans Side by Side</div>
                      <div className="mt-1 text-[12px] font-normal text-muted">
                        Start free in staging, scale on Cloud Run or inside your Private VPC.
                      </div>
                    </th>

                    {/* Tier 1: Developer Sandbox */}
                    <th className="w-[23%] border-l border-line px-5 py-5 align-top">
                      <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">
                        Developer Sandbox
                      </div>
                      <div className="mt-2 text-[28px] font-extrabold text-ink">
                        $0 <span className="text-[13px] font-normal text-muted">/ month</span>
                      </div>
                      <div className="text-[12px] font-medium text-muted">₹0 · Free forever</div>
                      <div className="mt-2 text-[12px] font-normal text-[#374151]">
                        For local agent prototyping, CI fault injection, and staging evaluations.
                      </div>
                    </th>

                    {/* Tier 2: Growth Cloud (Highlighted) */}
                    <th className="w-[23%] border-l-2 border-r-2 border-ink bg-[#eef4ff]/35 px-5 py-5 align-top">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#1d4ed8]">
                          Growth Cloud
                        </span>
                        <span className="rounded-full bg-[#1d4ed8] px-2.5 py-0.5 text-[10px] font-bold text-white">
                          Most Popular
                        </span>
                      </div>
                      <div className="mt-2 text-[28px] font-extrabold text-ink">
                        $299 <span className="text-[13px] font-normal text-muted">/ month</span>
                      </div>
                      <div className="text-[12px] font-medium text-[#1d4ed8]">≈ ₹24,999 / month</div>
                      <div className="mt-2 text-[12px] font-normal text-[#374151]">
                        Managed Google Cloud Run control plane for production write-action agents.
                      </div>
                    </th>

                    {/* Tier 3: Enterprise Private VPC */}
                    <th className="w-[23%] px-5 py-5 align-top">
                      <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink">
                        Enterprise Private VPC
                      </div>
                      <div className="mt-2 text-[28px] font-extrabold text-ink">
                        $1,499 <span className="text-[13px] font-normal text-muted">/ month</span>
                      </div>
                      <div className="text-[12px] font-medium text-muted">≈ ₹1,25,000 / mo (annual)</div>
                      <div className="mt-2 text-[12px] font-normal text-[#374151]">
                        Self-hosted inside your GCP / AWS Private VPC for regulated enterprises &amp; GCCs.
                      </div>
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-line">
                  {(
                    [
                      [
                        'Included Protected Transactions',
                        '2,500 / month',
                        '50,000 / month (+$4 per 1,000 extra)',
                        '500,000+ / month (Custom volume)',
                      ],
                      [
                        'Deployment Architecture',
                        'Local Docker / CLI',
                        'Managed Google Cloud Run',
                        'Customer Private VPC (GCP / AWS / On-Prem)',
                      ],
                      [
                        'Data Residency & Privacy',
                        'Local machine',
                        'Isolated tenant DB (asia-south1 / us-central1)',
                        '100% in-VPC (Zero data leaves your network)',
                      ],
                      [
                        'Safe Multi-System Staging Sandbox',
                        'Included ✓',
                        'Included ✓',
                        'Included ✓',
                      ],
                      [
                        'Deterministic Policy Gate (0 LLM Cost)',
                        '5 Core Policies',
                        'Unlimited Custom YAML Policies',
                        'Unlimited + Custom ERP Validation Hooks',
                      ],
                      [
                        'Automatic Reverse-Saga Rollback (< 20 ms)',
                        'Included ✓',
                        'Included ✓',
                        'Included ✓',
                      ],
                      [
                        'Pre-Built Enterprise Undo Connectors',
                        'Reference SQLite & REST',
                        'NetSuite, Stripe, Shopify, Jira & WMS',
                        'All Connectors + SAP, Oracle & Custom APIs',
                      ],
                      [
                        'Concurrent Human Manager Edit Protection',
                        'Basic version check',
                        'Full ETag 3-Way Diff & Quarantine ✓',
                        'Full 3-Way Diff + Slack / PagerDuty Alerts ✓',
                      ],
                      [
                        'High-Value Payout Approval Queue',
                        'Single dollar cap',
                        'Role-based approval queue ($5k+ cap) ✓',
                        'Multi-signer quorum & CFO policy routing ✓',
                      ],
                      [
                        'SHA-256 Audit Chain & Compliance Exports',
                        'Local JSON download',
                        '90-day audit retention + Webhook export',
                        '7-year SOX / ISO 27001 retention + SIEM feed',
                      ],
                      [
                        'Support & Uptime SLA',
                        'Community & Docs',
                        'Priority Engineering Support (99.9% SLA)',
                        '24/7 Dedicated FDE Support & 99.99% SLA',
                      ],
                    ] as Array<[string, string, string, string]>
                  ).map(([feature, col1, col2, col3]) => (
                    <tr key={feature} className="hover:bg-paper/40">
                      <td className="px-6 py-3.5 font-semibold text-ink">{feature}</td>
                      <td className="border-l border-line px-5 py-3.5 text-[#374151]">{col1}</td>
                      <td className="border-l-2 border-r-2 border-ink bg-[#eef4ff]/20 px-5 py-3.5 font-semibold text-ink">
                        {col2}
                      </td>
                      <td className="px-5 py-3.5 font-medium text-[#374151]">{col3}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

// ============================== Activity Log (Part of Demo) ================

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
          <h1 className="text-[24px] font-bold">Demo Activity Log &amp; Reports</h1>
          <p className="text-[13px] text-muted">History of simulated workflows, automatic rollbacks, and blocked threats</p>
        </div>
        <button
          onClick={onRun}
          className="rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-white hover:bg-black"
        >
          ← Back to Simulator
        </button>
      </div>

      {!config.aegis_enabled && (
        <div className="mt-4 rounded-lg border border-[#f3d9a4] bg-[#fef7e6] px-4 py-2 text-[13px] text-[#5c3700]">
          <span className="font-semibold">Ablate Protection is Off</span> · AI updates are currently bypassing the safety sandbox.
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Workflows Processed" value={receipts.length} />
        <Stat label="Threats Blocked" value={blocked} />
        <Stat label="Unprotected Mismatches" value={corrupted} tone={corrupted ? 'red' : undefined} />
        <Stat label="Median Rollback Speed" value={rb === null ? '—' : `${rb.toFixed(1)} ms`} />
      </div>

      <Card className="mt-5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[12px] font-semibold text-muted">
                <th className="px-5 py-3">Business Workflow</th>
                <th className="px-3 py-3">Result</th>
                <th className="px-3 py-3">What Happened</th>
                <th className="px-3 py-3">Recovery Action</th>
                <th className="px-5 py-3">Databases</th>
              </tr>
            </thead>
            <tbody>
              {indexed.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted">
                    No activity yet. Load a scenario in the Simulator tab.
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
                    <td className="px-5 py-3">
                      <div className="font-bold text-ink">{friendlyReceiptTitle(r, idx)}</div>
                      <div className="text-[11px] text-muted">
                        {r.aegis_enabled ? 'Ablate On' : 'Ablate Off'} · {r.ts ? new Date(r.ts).toLocaleTimeString() : ''}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${v.pill}`}>{v.label}</span>
                    </td>
                    <td className="max-w-[300px] px-3 py-3 text-[#374151]">
                      <span className="line-clamp-2">{v.line}</span>
                    </td>
                    <td className="px-3 py-3 text-[#374151]">
                      {r.compensations?.length
                        ? `${r.compensations.length} steps undone (${fmtMs(r.rollback_ms)})`
                        : r.status === 'ABORTED_IN_SHADOW'
                          ? 'Blocked in sandbox'
                          : 'None'}
                    </td>
                    <td className="px-5 py-3 font-semibold">
                      {r.hashes_match ? (
                        <span className="text-[#14532d]">In Sync ✓</span>
                      ) : r.status === 'QUARANTINED_CONCURRENT_EDIT' ? (
                        <span className="text-[#5c3700]">Manager Edit Kept ✓</span>
                      ) : (
                        <span className="text-danger">Out of Sync ✕</span>
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

// ============================== Workflow Report (CaseFile) =================

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
          Back to Activity Log
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

  const undoDone = comps.filter((c) => c.status === 'COMPENSATED').length;
  const keptEdit = comps.some((c) => c.status === 'QUARANTINED_CONCURRENT_EDIT');
  const undoCheck: [boolean, string] =
    comps.length === 0
      ? [true, 'No rollback required']
      : keptEdit
        ? [true, `${undoDone} changes undone; manager's edit was kept, not overwritten`]
        : [undoDone === comps.length, `${undoDone} of ${comps.length} automatic undo steps completed`];

  const integrity: Array<[boolean, string]> = [
    [Object.keys(receipt.pre_tx_hashes ?? {}).length === 3, 'Initial state captured across Orders, Warehouse, and Billing'],
    [
      receipt.status !== 'ABORTED_IN_SHADOW' && receipt.status !== 'ESCALATED_HITL' ? true : receipt.hashes_match,
      receipt.status === 'ABORTED_IN_SHADOW' || receipt.status === 'ESCALATED_HITL'
        ? 'Blocked in sandbox — zero live databases modified'
        : 'All company rules verified prior to execution',
    ],
    undoCheck,
    [linked, 'Chained to the previous audit record (SHA-256 fingerprint)'],
  ];
  if (!receipt.aegis_enabled) {
    integrity.splice(1, 2, [false, 'Ablate Protection was Off: no sandbox, no rules, no undo']);
  }

  return (
    <div className="mx-auto max-w-[1140px] px-6 py-6">
      <div className="text-[13px] text-muted">
        <button onClick={onBack} className="text-[#1d4ed8] underline">
          Activity Log
        </button>{' '}
        / {friendlyReceiptTitle(receipt, index)}
      </div>

      <Card className="mt-3">
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-4">
            <span className={`rounded-lg px-3.5 py-2 text-[14px] font-bold ${v.block}`}>{v.label}</span>
            <div>
              <div className="text-[19px] font-bold text-ink">{friendlyReceiptTitle(receipt, index)}</div>
              <div className="text-[13px] text-[#374151]">{v.line}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[12px] text-muted">
              {receipt.rollback_ms !== null && receipt.rollback_ms !== undefined ? 'Undo Time' : 'Execution Time'}
            </div>
            <div className="text-[22px] font-bold">{fmtMs(receipt.rollback_ms ?? receipt.commit_ms)}</div>
          </div>
        </div>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <Card title="Step-by-Step Execution & Undo">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[540px] text-left text-[13px]">
                <thead>
                  <tr className="border-y border-line text-[12px] font-semibold text-muted">
                    <th className="px-5 py-2.5">Action</th>
                    <th className="px-3 py-2.5">System Result</th>
                    <th className="px-3 py-2.5">Undo Action</th>
                    <th className="px-5 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {steps.length === 0 &&
                    staged.map((e, i) => {
                      const rawTool = String(e.message.split(' ')[0] ?? '');
                      const args = ((e.data as Record<string, unknown>)?.args ?? {}) as Record<string, unknown>;
                      return (
                        <tr key={i} className="border-b border-line last:border-0">
                          <td className="px-5 py-2.5">
                            <div className="font-bold text-ink">{friendlyToolName(rawTool)}</div>
                            <div className="text-[12px] text-muted">{friendlyArgs(rawTool, args)}</div>
                          </td>
                          <td className="px-3 py-2.5 text-muted">Held in sandbox</td>
                          <td className="px-3 py-2.5 text-muted">Prevented upfront</td>
                          <td className="px-5 py-2.5">
                            <Pill tone="green">BLOCKED IN SANDBOX</Pill>
                          </td>
                        </tr>
                      );
                    })}
                  {steps.map((s, i) => {
                    const c = compByStep.get(Number(s.step ?? i));
                    const failed = s.status === 'FAILED';
                    let tone: 'red' | 'green' | 'amber' | 'slate' = 'green';
                    let label = 'COMPLETED';
                    if (failed) {
                      tone = 'red';
                      label = 'REJECTED';
                    } else if (c?.status === 'COMPENSATED') {
                      tone = 'green';
                      label = 'UNDONE ✓';
                    } else if (c?.status === 'QUARANTINED_CONCURRENT_EDIT') {
                      tone = 'amber';
                      label = 'MANAGER EDIT KEPT';
                    } else if (!receipt.aegis_enabled && receipt.status === 'PARTIAL_CORRUPTION') {
                      tone = 'red';
                      label = 'LEFT MISMATCHED';
                    }
                    return (
                      <tr key={i} className={`border-b border-line last:border-0 ${failed ? 'bg-[#fffbfa]' : ''}`}>
                        <td className="px-5 py-2.5 font-bold text-ink">{friendlyToolName(s.tool)}</td>
                        <td className="px-3 py-2.5 text-[#374151]">
                          {failed ? 'Invoice Locked (Error)' : 'Updated'}
                        </td>
                        <td className="px-3 py-2.5 text-[#374151]">
                          {c ? friendlyUndoStrategy(String(c.strategy), s.tool) : failed ? 'Triggered undo' : 'None'}
                        </td>
                        <td className="px-5 py-2.5">
                          <Pill tone={tone}>{label}</Pill>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Company Safety Rules Checked">
            <div className="divide-y divide-line border-t border-line">
              {checks.map((c) => {
                const key = c.name.startsWith('dry_run') ? 'dry_run' : c.name;
                const meta = INVARIANT_META[key];
                return (
                  <div key={c.name} className="flex items-center justify-between gap-4 px-5 py-2.5">
                    <div>
                      <div className="text-[13px] font-bold text-ink">{meta?.label ?? c.name}</div>
                      <div className="text-[12px] text-muted">{checkSummary(c) || meta?.desc}</div>
                    </div>
                    <Pill tone={checkTone(c.result)}>
                      {c.result === 'ESCALATE_HITL' ? 'OVER LIMIT' : c.result === 'FAIL' ? 'BLOCKED' : 'PASSED ✓'}
                    </Pill>
                  </div>
                );
              })}
              {checks.length === 0 && (
                <div className="px-5 py-4 text-[13px] text-muted">Safety rules were skipped (Ablate Off).</div>
              )}
            </div>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card title="Safety Checklist">
            <ul className="space-y-2 px-5 pb-4 text-[13px]">
              {integrity.map(([ok, text]) => (
                <li key={text} className="flex gap-2">
                  <span className={ok ? 'font-bold text-[#15803d]' : 'font-bold text-danger'}>{ok ? '✓' : '✗'}</span>
                  <span className="text-[#374151]">{text}</span>
                </li>
              ))}
            </ul>
          </Card>

          <button
            onClick={() => download(`ablate-report-${receipt.tx_id}.json`, receipt)}
            className="w-full rounded-lg bg-ink py-2.5 text-[13px] font-semibold text-white hover:bg-black"
          >
            Download Audit Report (JSON)
          </button>
          <button
            onClick={onEvidence}
            className="w-full rounded-lg border border-line bg-white py-2.5 text-[13px] hover:bg-paper"
          >
            View Event Timeline →
          </button>
        </aside>
      </div>
    </div>
  );
}

// ============================== Event Timeline =============================

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
          {receipt ? friendlyReceiptTitle(receipt, index) : 'Report'}
        </button>{' '}
        / Timeline
      </div>
      <h1 className="mt-2 text-[22px] font-bold">Execution Timeline</h1>

      <Card className="mt-4" title="Chronological Steps">
        <ol className="max-h-[420px] overflow-y-auto border-t border-line">
          {txEvents.length === 0 && (
            <li className="px-5 py-4 text-[13px] text-muted">No timeline events in memory.</li>
          )}
          {txEvents.map((e, i) => (
            <li key={i} className="flex items-start gap-3 border-b border-line px-5 py-2 text-[13px] last:border-0">
              <span className="w-[75px] shrink-0 font-mono text-[11px] text-muted">{e.ts.slice(11, 19)}</span>
              <span
                className={`w-[78px] shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-bold ${
                  PHASE_TONE[e.phase] ?? 'bg-[#f3f4f6] text-muted'
                }`}
              >
                {e.phase}
              </span>
              <span className="text-[#374151]">{e.message}</span>
            </li>
          ))}
        </ol>
      </Card>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        {state &&
          (
            [
              ['Orders (ERP)', [['Purchase Orders', state.erp.purchase_orders], ['Ledger Entries', state.erp.gl_entries]]],
              ['Warehouse', [['Inventory', state.wms.inventory]]],
              ['Billing', [['Invoices', state.billing.invoices], ['Credit Notes', state.billing.credit_notes]]],
            ] as Array<[string, Array<[string, unknown[]]>]>
          ).map(([name, tables]) => (
            <Card key={name} title={name}>
              {tables.map(([t, rows]) => (
                <div key={t} className="border-t border-line">
                  <div className="px-3 pt-2 text-[11px] font-semibold uppercase text-muted">{t}</div>
                  <DataTable rows={rows as Array<Record<string, unknown>>} />
                </div>
              ))}
            </Card>
          ))}
      </div>
    </div>
  );
}

// ============================== Compliance (Part of Demo) ==================

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
      <h1 className="text-[24px] font-bold">Compliance &amp; Audit Verification</h1>
      <p className="text-[13px] text-muted">
        Each audit record carries a SHA-256 fingerprint of the record before it, so any later edit is detected.
      </p>

      <div
        className={`mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 px-5 py-3 ${
          !server ? 'border-line' : server.chain_valid ? 'border-[#15803d] bg-[#f3faf5]' : 'border-danger bg-[#fffbfa]'
        }`}
      >
        <div className={`text-[14px] font-bold ${!server ? 'text-muted' : server.chain_valid ? 'text-[#15803d]' : 'text-danger'}`}>
          {!server
            ? 'Checking audit log…'
            : server.chain_valid
              ? `All ${server.verified} Audit Records Hash-Verified ✓`
              : 'Audit Alert: Broken Hash Link Detected'}
        </div>
        <button
          onClick={() => void runVerify()}
          disabled={checking}
          className="rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-white hover:bg-black disabled:opacity-50"
        >
          {checking ? 'Verifying…' : 'Verify Audit Log'}
        </button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total Audit Records" value={receipts.length} />
        <Stat label="Chain Links Intact" value={`${verified}/${receipts.length}`} />
        <Stat label="Auto-Restored Runs" value={clean} />
        <Stat label="Threats Blocked" value={blocked} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_320px]">
        <Card className="overflow-hidden">
          <div className="max-h-[480px] overflow-y-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-line text-[12px] font-semibold text-muted">
                  <th className="px-5 py-2.5">#</th>
                  <th className="px-3 py-2.5">Workflow</th>
                  <th className="px-3 py-2.5">Result</th>
                  <th className="px-5 py-2.5">Audit Status</th>
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
                    <td className="px-5 py-2.5 font-semibold">#{i + 1}</td>
                    <td className="px-3 py-2.5 font-medium text-ink">{friendlyReceiptTitle(x, i)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${verdictOf(x.status).pill}`}>
                        {verdictOf(x.status).label}
                      </span>
                    </td>
                    <td className={`px-5 py-2.5 font-semibold ${links[i] ? 'text-[#15803d]' : 'text-danger'}`}>
                      {links[i] ? 'Chain Link Intact ✓' : 'Broken Link ✗'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        {r && pick !== null && (
          <div className={`h-fit rounded-xl border-2 p-4 ${links[pick] ? 'border-[#15803d]' : 'border-danger'}`}>
            <div className={`text-[11px] font-bold uppercase ${links[pick] ? 'text-[#15803d]' : 'text-danger'}`}>
              RECORD #{pick + 1} · {links[pick] ? 'CHAIN LINK INTACT' : 'BROKEN LINK'}
            </div>
            <div className="mt-1.5 text-[15px] font-bold text-ink">{friendlyReceiptTitle(r, pick)}</div>
            <div className="mt-1 text-[12px] text-[#374151]">{verdictOf(r.status).line}</div>
            <div className="mt-3 rounded-lg bg-[#f3f4f6] p-2.5 text-[11px] text-[#374151]">
              <div>
                Fingerprint (SHA-256): <span className="font-mono">{short(r.receipt_hash, 14)}</span>
              </div>
            </div>
            <button onClick={() => onOpen(r.tx_id)} className="mt-3 text-[13px] font-semibold text-[#1d4ed8] underline">
              Open Full Report →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
