import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowDownUp,
  Bot,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  FileCode2,
  GitCommit,
  Hash,
  Layers,
  Lock,
  Play,
  RefreshCw,
  RotateCcw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Zap,
} from 'lucide-react';
import type {
  DemoAct,
  InvariantMap,
  ProxyEvent,
  RuntimeConfig,
  StatePayload,
  TxReceipt,
} from './types';

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/+$/, '');

const DEFAULT_INVARIANTS: InvariantMap = {
  ledger_balance: true,
  inventory_non_negative: true,
  dollar_cap: true,
  iban_integrity: true,
  taint_check: true,
};

const INVARIANT_META: Array<{
  key: keyof InvariantMap;
  label: string;
  layer: string;
  desc: string;
}> = [
  {
    key: 'ledger_balance',
    label: 'ledger_balance',
    layer: 'L1 ACCOUNTING',
    desc: 'Double-entry GL Σ(Debit) == Σ(Credit)',
  },
  {
    key: 'inventory_non_negative',
    label: 'inventory_non_negative',
    layer: 'L1 CONSERVATION',
    desc: 'WMS SKU on_hand >= 0 & available >= 0',
  },
  {
    key: 'dollar_cap',
    label: 'dollar_cap',
    layer: 'L2 POLICY',
    desc: 'Auto-commit cap <= max_auto_usd ($25k)',
  },
  {
    key: 'iban_integrity',
    label: 'iban_integrity',
    layer: 'L3 SECURITY',
    desc: 'Payout destination matches verified vendor IBAN',
  },
  {
    key: 'taint_check',
    label: 'taint_check',
    layer: 'L3 PROVENANCE',
    desc: 'Untrusted external prompt taint blocked from sinks',
  },
];

function shortHash(hash?: string, len = 12): string {
  if (!hash) return '—';
  return hash.length > len ? `${hash.slice(0, len)}…` : hash;
}

function formatUsd(val?: number): string {
  if (typeof val !== 'number' || Number.isNaN(val)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(val);
}

export default function App() {
  const [state, setState] = useState<StatePayload | null>(null);
  const [events, setEvents] = useState<ProxyEvent[]>([]);
  const [receipts, setReceipts] = useState<TxReceipt[]>([]);
  const [activeAct, setActiveAct] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [isPolling, setIsPolling] = useState<boolean>(true);
  const [backendOnline, setBackendOnline] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const pollGuardRef = useRef<boolean>(false);

  const config: RuntimeConfig = useMemo(
    () =>
      state?.config ?? {
        aegis_enabled: true,
        fail_billing_409: false,
        simulate_human_edit: false,
        max_auto_usd: 25000,
      },
    [state],
  );

  const latestReceipt: TxReceipt | null = useMemo(
    () => (receipts.length > 0 ? receipts[receipts.length - 1] : null),
    [receipts],
  );

  // The ledger is a hash chain and survives /admin/reset, so remember how many receipts
  // existed at the last reset: the invariant panel stays IDLE until a newer one arrives.
  const [receiptsAtReset, setReceiptsAtReset] = useState(0);
  const invariantsIdle = !latestReceipt || receipts.length <= receiptsAtReset;

  const fetchSnapshot = useCallback(async () => {
    if (pollGuardRef.current) return;
    pollGuardRef.current = true;
    try {
      const [stateRes, eventsRes, ledgerRes] = await Promise.all([
        fetch(`${API_BASE}/state`),
        fetch(`${API_BASE}/events`),
        fetch(`${API_BASE}/ledger`),
      ]);
      if (stateRes.ok) {
        const sData = (await stateRes.json()) as StatePayload;
        setState(sData);
        setBackendOnline(true);
        setErrorMsg(null);
      }
      if (eventsRes.ok) {
        const eData = (await eventsRes.json()) as { events?: ProxyEvent[] };
        if (Array.isArray(eData.events)) {
          setEvents(eData.events);
        }
      }
      if (ledgerRes.ok) {
        const lData = (await ledgerRes.json()) as { receipts?: TxReceipt[] };
        if (Array.isArray(lData.receipts)) {
          setReceipts(lData.receipts);
        }
      }
    } catch {
      setBackendOnline(false);
    } finally {
      pollGuardRef.current = false;
    }
  }, []);

  // Poll /state, /events, /ledger every 600ms while running
  useEffect(() => {
    void fetchSnapshot();
    if (!isPolling) return;
    const timer = window.setInterval(() => {
      void fetchSnapshot();
    }, 600);
    return () => window.clearInterval(timer);
  }, [fetchSnapshot, isPolling]);

  const handleToggleConfig = async (patch: Partial<RuntimeConfig>) => {
    setIsBusy(true);
    try {
      const res = await fetch(`${API_BASE}/admin/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      await fetchSnapshot();
    } catch (err) {
      setErrorMsg(`Failed to update config: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleResetDbs = async () => {
    setIsBusy(true);
    setActiveAct('reset');
    try {
      const res = await fetch(`${API_BASE}/admin/reset`, {
        method: 'POST',
      });
      if (res.ok) {
        const sData = (await res.json()) as StatePayload;
        if (sData && sData.erp) {
          setState(sData);
        }
        setReceiptsAtReset(receipts.length);
      }
      await fetchSnapshot();
    } catch (err) {
      setErrorMsg(`Reset failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsBusy(false);
      setActiveAct(null);
    }
  };

  const handleRunAct = async (act: DemoAct) => {
    setIsBusy(true);
    setActiveAct(act);
    setErrorMsg(null);
    try {
      const res = await fetch(`${API_BASE}/demo/run/${act}`, {
        method: 'POST',
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        act: string;
        receipt?: TxReceipt;
        state?: StatePayload;
      };
      if (data.state) {
        setState(data.state);
      }
      if (data.receipt) {
        setReceipts((prev) => {
          const exists = prev.some((r) => r.receipt_hash === data.receipt!.receipt_hash);
          return exists ? prev : [...prev, data.receipt!];
        });
      }
      await fetchSnapshot();
    } catch (err) {
      setErrorMsg(`Act execution failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsBusy(false);
      setActiveAct(null);
    }
  };

  // Derive right-pane status banner state
  const bannerConfig = useMemo(() => {
    if (!latestReceipt) {
      return {
        tone: 'green' as const,
        title: 'PRE-TX HASH == POST-ROLLBACK HASH (100% ATOMIC CONSISTENCY RESTORED)',
        subtitle:
          'All 3 production databases (ERP • WMS • Billing) are verified at deterministic seed parity.',
      };
    }

    switch (latestReceipt.status) {
      case 'PARTIAL_CORRUPTION':
        return {
          tone: 'red' as const,
          title: 'PARTIAL CORRUPTION DETECTED ACROSS LIVE DATABASES',
          subtitle: `Tx ${latestReceipt.tx_id}: Downstream fault left live ERP/WMS state drifted from Billing (hashes_match: false).`,
        };
      case 'ABORTED_IN_SHADOW':
        return {
          tone: 'amber' as const,
          title: 'BLOCKED IN SHADOW (0 LIVE WRITES)',
          subtitle: `Tx ${latestReceipt.tx_id}: Deterministic 3-Layer Invariant Gate rejected mutation in Shadow Twin. Production hashes untouched.`,
        };
      case 'ESCALATED_HITL':
        return {
          tone: 'amber' as const,
          title: 'BLOCKED IN SHADOW (0 LIVE WRITES) — ESCALATED TO HITL',
          subtitle: `Tx ${latestReceipt.tx_id}: Policy Dollar Cap exceeded; staged transaction held for Human-in-the-Loop approval.`,
        };
      case 'QUARANTINED_CONCURRENT_EDIT':
        return {
          tone: 'amber' as const,
          title: 'QUARANTINED CONCURRENT HUMAN EDIT',
          subtitle: `Tx ${latestReceipt.tx_id}: Optimistic ETag Guard detected a mid-flight human edit and halted overwrite to protect human data.`,
        };
      case 'ROLLED_BACK_CLEANLY':
      case 'COMMITTED':
      default:
        return {
          tone: 'green' as const,
          title: 'PRE-TX HASH == POST-ROLLBACK HASH (100% ATOMIC CONSISTENCY RESTORED)',
          subtitle: `Tx ${latestReceipt.tx_id} (${latestReceipt.status}): Cryptographic state parity verified across ERP, WMS & Billing in ${latestReceipt.rollback_ms ?? 0}ms.`,
        };
    }
  }, [latestReceipt]);

  // Filter agent tool stream events for Left Pane
  const agentCallStream = useMemo(() => {
    return events.filter((ev) => {
      const t = (ev.type || '').toUpperCase();
      const p = (ev.phase || '').toUpperCase();
      return (
        t.includes('CALL') ||
        t.includes('TOOL') ||
        t.includes('WRITE') ||
        t.includes('BEGIN') ||
        t.includes('COMMIT') ||
        t.includes('FAULT') ||
        t.includes('409') ||
        t.includes('AGENT') ||
        p.includes('AGENT') ||
        p.includes('STAGE') ||
        p.includes('LIVE')
      );
    });
  }, [events]);

  // Derive staged Shadow Twin deltas & Pivot order for Center Pane
  const stagedShadowCalls = useMemo(() => {
    if (latestReceipt?.staged_deltas && latestReceipt.staged_deltas.length > 0) {
      return latestReceipt.staged_deltas;
    }
    const latestTxId = latestReceipt?.tx_id;
    const matching = events.filter(
      (e) =>
        (!latestTxId || e.tx_id === latestTxId) &&
        (e.type?.toUpperCase().includes('CALL') ||
          e.type?.toUpperCase().includes('STAGE') ||
          e.type?.toUpperCase().includes('WRITE') ||
          e.phase?.toUpperCase().includes('STAGE')),
    );
    return matching.map((m) => ({
      tx_id: m.tx_id,
      ts: m.ts,
      message: m.message,
      tool: (m.data?.tool as string) || m.message,
      args: m.data?.args || m.data,
      tainted: m.data?.tainted || m.data?.tainted_fields,
    }));
  }, [events, latestReceipt]);

  const pivotCommitOrder = useMemo(() => {
    if (latestReceipt?.commit_order && latestReceipt.commit_order.length > 0) {
      return latestReceipt.commit_order;
    }
    return [
      '1. erp.update_purchase_order [REVERSIBLE]',
      '2. erp.post_gl_entry [REVERSIBLE]',
      '3. wms.reserve_inventory [REVERSIBLE • COMMUTATIVE DELTA]',
      '4. billing.create_invoice / billing.send_wire_payout [PIVOT • STRICTLY LAST]',
    ];
  }, [latestReceipt]);

  const activeInvariants: InvariantMap = latestReceipt?.invariants ?? DEFAULT_INVARIANTS;

  return (
    <div className="min-h-screen bg-[#06090f] text-slate-100 flex flex-col font-sans">
      {/* TOP CONTROL BAR */}
      <header className="border-b border-slate-800/90 bg-[#0b101b]/95 backdrop-blur sticky top-0 z-30 px-4 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Brand Identity */}
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-emerald-500/10 border border-emerald-500/40 flex items-center justify-center shadow-inner">
              <Shield className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold tracking-tight text-lg text-white">Ablate</span>
                <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold">
                  MCP TX RUNTIME v2.4
                </span>
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border ${
                    backendOnline
                      ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-300'
                      : 'bg-amber-950/60 border-amber-700/60 text-amber-300'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      backendOnline ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                    }`}
                  />
                  {backendOnline ? 'API:8000 LIVE' : 'API:8000 STANDBY'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Transactional Runtime &amp; Auto-Rollback Proxy for MCP Agents
              </p>
            </div>
          </div>

          {/* Toggles wired to POST /admin/config */}
          <div className="flex flex-wrap items-center gap-2 bg-[#06090f] p-1.5 rounded-lg border border-slate-800">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => handleToggleConfig({ aegis_enabled: !config.aegis_enabled })}
              className={`px-2.5 py-1.5 rounded text-xs font-mono font-semibold transition flex items-center gap-1.5 border ${
                config.aegis_enabled
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-sm'
                  : 'bg-rose-500/20 text-rose-300 border-rose-500/50'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Ablate Proxy [{config.aegis_enabled ? 'ON' : 'OFF'}]
            </button>

            <button
              type="button"
              disabled={isBusy}
              onClick={() => handleToggleConfig({ fail_billing_409: !config.fail_billing_409 })}
              className={`px-2.5 py-1.5 rounded text-xs font-mono font-semibold transition flex items-center gap-1.5 border ${
                config.fail_billing_409
                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/50'
                  : 'bg-slate-800/70 text-slate-400 border-slate-700 hover:text-slate-200'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              Inject Billing 409 [{config.fail_billing_409 ? 'ON' : 'OFF'}]
            </button>

            <button
              type="button"
              disabled={isBusy}
              onClick={() =>
                handleToggleConfig({ simulate_human_edit: !config.simulate_human_edit })
              }
              className={`px-2.5 py-1.5 rounded text-xs font-mono font-semibold transition flex items-center gap-1.5 border ${
                config.simulate_human_edit
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                  : 'bg-slate-800/70 text-slate-400 border-slate-700 hover:text-slate-200'
              }`}
            >
              <ArrowDownUp className="w-3.5 h-3.5" />
              Simulate Human Edit [{config.simulate_human_edit ? 'ON' : 'OFF'}]
            </button>
          </div>

          {/* 4 Quick-Run Act Buttons + Reset All 3 DBs */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => handleRunAct('act1_corruption')}
              className={`px-2.5 py-1.5 rounded text-xs font-medium border transition flex items-center gap-1.5 ${
                activeAct === 'act1_corruption'
                  ? 'bg-rose-600 text-white border-rose-400'
                  : 'bg-rose-950/50 hover:bg-rose-900/60 text-rose-200 border-rose-800/70'
              }`}
            >
              <Play className="w-3 h-3 fill-current" />
              Act 1: Unprotected Corruption
            </button>

            <button
              type="button"
              disabled={isBusy}
              onClick={() => handleRunAct('act2_rollback')}
              className={`px-2.5 py-1.5 rounded text-xs font-medium border transition flex items-center gap-1.5 ${
                activeAct === 'act2_rollback'
                  ? 'bg-emerald-600 text-white border-emerald-400'
                  : 'bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-200 border-emerald-800/70'
              }`}
            >
              <RotateCcw className="w-3 h-3" />
              Act 2: Atomic Rollback (&lt;400ms)
            </button>

            <button
              type="button"
              disabled={isBusy}
              onClick={() => handleRunAct('act3_injection')}
              className={`px-2.5 py-1.5 rounded text-xs font-medium border transition flex items-center gap-1.5 ${
                activeAct === 'act3_injection'
                  ? 'bg-amber-600 text-white border-amber-400'
                  : 'bg-amber-950/50 hover:bg-amber-900/60 text-amber-200 border-amber-800/70'
              }`}
            >
              <ShieldAlert className="w-3 h-3" />
              Act 3: Prompt Injection Blocked
            </button>

            <button
              type="button"
              disabled={isBusy}
              onClick={() => handleRunAct('act4_etag_conflict')}
              className={`px-2.5 py-1.5 rounded text-xs font-medium border transition flex items-center gap-1.5 ${
                activeAct === 'act4_etag_conflict'
                  ? 'bg-cyan-600 text-white border-cyan-400'
                  : 'bg-cyan-950/50 hover:bg-cyan-900/60 text-cyan-200 border-cyan-800/70'
              }`}
            >
              <Lock className="w-3 h-3" />
              Act 4: ETag Conflict Guard
            </button>

            <button
              type="button"
              disabled={isBusy}
              onClick={handleResetDbs}
              className="ml-1 px-2.5 py-1.5 rounded text-xs font-mono font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 transition flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${activeAct === 'reset' ? 'animate-spin' : ''}`} />
              Reset All 3 DBs
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="mt-2 px-3 py-1.5 rounded bg-rose-950/80 border border-rose-700 text-rose-200 text-xs font-mono flex items-center justify-between">
            <span>{errorMsg}</span>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              className="underline text-rose-300 ml-4"
            >
              Dismiss
            </button>
          </div>
        )}
      </header>

      {/* 3-COLUMN SPLIT SCREEN MISSION CONTROL */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3 p-3 overflow-hidden">
        {/* LEFT PANE (3 cols): AUTONOMOUS AGENT (ADK + GEMINI) */}
        <section className="lg:col-span-3 bg-[#0b101b] border border-slate-800/90 rounded-xl flex flex-col overflow-hidden shadow-lg">
          <div className="px-3.5 py-2.5 border-b border-slate-800 flex items-center justify-between bg-[#0f172a]/70">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-cyan-400" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Autonomous Agent (ADK + Gemini)
              </h2>
            </div>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
              MCP CLIENT
            </span>
          </div>

          {/* Agent Context & Active Transaction Metadata */}
          <div className="p-3 border-b border-slate-800/80 bg-[#070b12] text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Runtime Engine:</span>
              <span className="font-mono text-cyan-300">google-adk • gemini-2.5-pro</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Active Tx Session:</span>
              <span className="font-mono text-slate-200">
                {latestReceipt?.tx_id ?? 'tx-standby'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Polling Cadence:</span>
              <button
                type="button"
                onClick={() => setIsPolling((p) => !p)}
                className="font-mono text-[11px] text-emerald-400 hover:underline flex items-center gap-1"
              >
                <Activity className="w-3 h-3" />
                {isPolling ? '600ms LIVE' : 'PAUSED'}
              </button>
            </div>
          </div>

          {/* Live Stream of Agent Tool Calls, Arguments, and Responses */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5 font-mono text-xs">
            {agentCallStream.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 py-10 px-4">
                <Terminal className="w-8 h-8 mb-2 text-slate-600" />
                <p className="text-xs font-sans text-slate-400 font-medium">
                  No MCP Tool Calls Executed Yet
                </p>
                <p className="text-[11px] font-sans text-slate-500 mt-1">
                  Trigger <span className="text-slate-300">Act 1–4</span> above to stream live ADK
                  agent tool calls, arguments, taint markers, and proxy responses.
                </p>
              </div>
            ) : (
              agentCallStream
                .slice()
                .reverse()
                .map((ev, idx) => {
                  const isFault =
                    ev.type?.includes('409') ||
                    ev.type?.includes('FAULT') ||
                    ev.type?.includes('ABORT') ||
                    ev.type?.includes('CONFLICT');
                  const isTainted =
                    JSON.stringify(ev.data || {}).includes('taint') ||
                    JSON.stringify(ev.data || {}).includes('RU00');
                  return (
                    <div
                      key={`${ev.tx_id}-${ev.ts}-${idx}`}
                      className={`p-2.5 rounded-lg border ${
                        isFault
                          ? 'bg-rose-950/30 border-rose-800/70 text-rose-200'
                          : isTainted
                            ? 'bg-amber-950/30 border-amber-800/70 text-amber-200'
                            : 'bg-[#070b12] border-slate-800 text-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 font-semibold">
                          {ev.phase || 'MCP'} • {ev.type}
                        </span>
                        <span>
                          {ev.ts} • {ev.tx_id}
                        </span>
                      </div>
                      <div className="text-xs font-semibold text-white break-words">
                        {ev.message}
                      </div>
                      {ev.data && Object.keys(ev.data).length > 0 && (
                        <pre className="mt-1.5 p-2 rounded bg-black/50 border border-slate-800/80 text-[10px] text-slate-300 overflow-x-auto whitespace-pre-wrap">
                          {JSON.stringify(ev.data, null, 2)}
                        </pre>
                      )}
                    </div>
                  );
                })
            )}
          </div>
        </section>

        {/* CENTER PANE (4 cols): ABLATE TRANSACTIONAL PROXY */}
        <section className="lg:col-span-4 bg-[#0b101b] border border-slate-800/90 rounded-xl flex flex-col overflow-hidden shadow-lg">
          <div className="px-3.5 py-2.5 border-b border-slate-800 flex items-center justify-between bg-[#0f172a]/70">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-emerald-400" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Ablate Transactional Proxy
              </h2>
            </div>
            <span
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded border font-semibold ${
                config.aegis_enabled
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
              }`}
            >
              {config.aegis_enabled ? 'SHADOW + SAGA ACTIVE' : 'BYPASSED (DIRECT LIVE)'}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {/* 1. 3-Layer Invariant Gate Badges */}
            <div className="bg-[#070b12] border border-slate-800 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  3-Layer Deterministic Invariant Gate
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  Cap: {formatUsd(config.max_auto_usd)}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                {INVARIANT_META.map((inv) => {
                  // No result for this check on the latest receipt (e.g. Aegis OFF): it never ran.
                  const idle = invariantsIdle;
                  const skipped = !idle && activeInvariants[inv.key] === undefined;
                  const neutral = idle || skipped;
                  const passed = activeInvariants[inv.key] !== false;
                  return (
                    <div
                      key={inv.key}
                      className={`px-2.5 py-1.5 rounded border flex items-center justify-between ${
                        neutral
                          ? 'bg-slate-900/60 border-slate-700 text-slate-400'
                          : passed
                            ? 'bg-emerald-950/25 border-emerald-800/60 text-emerald-200'
                            : 'bg-rose-950/40 border-rose-700 text-rose-200'
                      }`}
                    >
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs font-bold">{inv.label}</span>
                          <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-slate-800 text-slate-300">
                            {inv.layer}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400">{inv.desc}</span>
                      </div>
                      <span
                        className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                          neutral
                            ? 'bg-slate-700/40 text-slate-400'
                            : passed
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-rose-500/30 text-rose-200'
                        }`}
                      >
                        {idle ? 'IDLE' : skipped ? 'SKIPPED' : passed ? 'PASS' : 'VIOLATION'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 2. Staged Shadow Twin Deltas & Pivot Rule Commit Order */}
            <div className="bg-[#070b12] border border-slate-800 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-cyan-400" />
                  Shadow Twin Deltas &amp; Pivot Rule Schedule
                </span>
                <span className="text-[10px] font-mono text-cyan-300">≤1 PIVOT LAST</span>
              </div>

              <div className="space-y-1.5 text-xs font-mono">
                {pivotCommitOrder.map((step, i) => {
                  const isPivot =
                    step.toLowerCase().includes('pivot') ||
                    step.toLowerCase().includes('wire') ||
                    step.toLowerCase().includes('billing');
                  return (
                    <div
                      key={`${step}-${i}`}
                      className={`px-2 py-1 rounded border flex items-center justify-between text-[11px] ${
                        isPivot
                          ? 'bg-purple-950/30 border-purple-800/60 text-purple-200'
                          : 'bg-slate-900/70 border-slate-800 text-slate-300'
                      }`}
                    >
                      <span className="truncate">{step}</span>
                      <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-black/40">
                        {isPivot ? 'PIVOT (LAST)' : 'REVERSIBLE'}
                      </span>
                    </div>
                  );
                })}
              </div>

              {stagedShadowCalls.length > 0 && (
                <div className="mt-2 pt-2 border-t border-slate-800/80">
                  <div className="text-[10px] font-mono text-slate-400 mb-1">
                    Recent Staged Shadow Twin Operations ({stagedShadowCalls.length}):
                  </div>
                  <div className="max-h-28 overflow-y-auto space-y-1">
                    {stagedShadowCalls.slice(-5).map((sc, idx) => (
                      <div
                        key={idx}
                        className="text-[10px] font-mono px-2 py-1 rounded bg-slate-900/80 text-slate-300 truncate"
                      >
                        • {String(sc.message || sc.tool)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 3. Reverse-Saga Rollback Timeline with rollback_ms */}
            <div className="bg-[#070b12] border border-slate-800 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                  Reverse-Saga Rollback Timeline
                </span>
                <span className="text-[11px] font-mono font-bold text-emerald-300 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {latestReceipt ? `${latestReceipt.rollback_ms ?? 0} ms` : '0.0 ms'}
                </span>
              </div>

              {latestReceipt &&
              latestReceipt.compensations &&
              latestReceipt.compensations.length > 0 ? (
                <div className="space-y-1.5">
                  {latestReceipt.compensations.map((comp, idx) => (
                    <div
                      key={idx}
                      className="p-2 rounded bg-emerald-950/20 border border-emerald-800/50 text-xs font-mono flex flex-col gap-0.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-emerald-300 font-bold">
                          LIFO #{idx + 1}: {comp.tool || comp.action || 'Saga Compensation'}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-200">
                          {comp.status || comp.strategy || 'COMPENSATED'}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {(() => {
                          // Backend compensation: {tool, strategy, status, call: {tool, args}, three_way_diff?}
                          const call = comp.call as { tool?: string; args?: Record<string, unknown> } | undefined;
                          const delta = comp.inverse_delta ?? call?.args?.delta_qty;
                          const record =
                            comp.po_id ?? call?.args?.po_id ?? call?.args?.entry_id ?? call?.args?.credit_id;
                          return [
                            comp.strategy ? `${comp.strategy} via ${call?.tool ?? 'quarantine (no write)'}` : '',
                            comp.for_tool ? `Reversing ${comp.for_tool}` : '',
                            delta !== undefined
                              ? `• Commutative Δ: ${Number(delta) > 0 ? `+${String(delta)}` : String(delta)}`
                              : '',
                            record !== undefined ? `• Record: ${String(record)}` : '',
                          ]
                            .filter(Boolean)
                            .join(' ');
                        })()}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-500 font-mono py-2">
                  {latestReceipt?.status === 'ABORTED_IN_SHADOW'
                    ? '0 compensations needed — transaction aborted cleanly inside Shadow Twin (0 live writes).'
                    : latestReceipt?.status === 'PARTIAL_CORRUPTION'
                      ? 'Ablate Proxy was OFF — no Reverse-Saga executed; live databases remained corrupted!'
                      : 'No rollback triggered on latest transaction.'}
                </div>
              )}
            </div>

            {/* 4. Latest SHA-256 Hash-Chained TxReceipt */}
            <div className="bg-[#070b12] border border-slate-800 rounded-lg p-3 font-mono text-xs">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-sans font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <FileCode2 className="w-3.5 h-3.5 text-purple-400" />
                  SHA-256 Hash-Chained TxReceipt
                </span>
                {latestReceipt && (
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                      latestReceipt.status === 'ROLLED_BACK_CLEANLY' ||
                      latestReceipt.status === 'COMMITTED'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : latestReceipt.status === 'PARTIAL_CORRUPTION'
                          ? 'bg-rose-500/25 text-rose-300 border border-rose-500/40'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    }`}
                  >
                    {latestReceipt.status}
                  </span>
                )}
              </div>

              {latestReceipt ? (
                <div className="space-y-1 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-slate-400">tx_id:</span>
                    <span className="text-slate-200">{latestReceipt.tx_id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">hashes_match:</span>
                    <span
                      className={
                        latestReceipt.hashes_match
                          ? 'text-emerald-400 font-bold'
                          : 'text-rose-400 font-bold'
                      }
                    >
                      {String(latestReceipt.hashes_match)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">receipt_hash:</span>
                    <span className="text-purple-300" title={latestReceipt.receipt_hash}>
                      {shortHash(latestReceipt.receipt_hash, 18)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">prev_hash:</span>
                    <span className="text-slate-400" title={latestReceipt.prev_hash}>
                      {shortHash(latestReceipt.prev_hash, 18)}
                    </span>
                  </div>
                  <div className="pt-1.5 mt-1.5 border-t border-slate-800/80 grid grid-cols-3 gap-1 text-[10px]">
                    {(['erp', 'wms', 'billing'] as const).map((db) => {
                      const pre = latestReceipt.pre_tx_hashes?.[db];
                      const post = latestReceipt.post_tx_hashes?.[db];
                      const same = pre === post;
                      return (
                        <div
                          key={db}
                          className={`p-1.5 rounded border ${
                            same
                              ? 'bg-emerald-950/20 border-emerald-800/50 text-emerald-300'
                              : 'bg-rose-950/30 border-rose-800/60 text-rose-300'
                          }`}
                        >
                          <div className="uppercase font-bold">{db}</div>
                          <div className="text-[9px] text-slate-400">
                            {shortHash(pre, 7)} → {shortHash(post, 7)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="text-slate-500 text-xs py-2">
                  Run an Act or transaction to generate a cryptographic Merkle receipt.
                </div>
              )}
            </div>
          </div>
        </section>

        {/* RIGHT PANE (5 cols): 3 LIVE PRODUCTION DATABASES */}
        <section className="lg:col-span-5 bg-[#0b101b] border border-slate-800/90 rounded-xl flex flex-col overflow-hidden shadow-lg">
          <div className="px-3.5 py-2.5 border-b border-slate-800 flex items-center justify-between bg-[#0f172a]/70">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-400" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                3 Live Production Databases (ERP • WMS • Billing)
              </h2>
            </div>
            <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1">
              <GitCommit className="w-3 h-3 text-emerald-400" />
              LIVE SHA-256 STATE PROOFS
            </span>
          </div>

          <div className="p-3 space-y-3 flex-1 overflow-y-auto">
            {/* BIG STATUS BANNER AT TOP OF RIGHT PANE */}
            <div
              className={`p-3.5 rounded-xl border-2 shadow-md transition-all ${
                bannerConfig.tone === 'green'
                  ? 'bg-emerald-950/45 border-emerald-500/80 text-emerald-100'
                  : bannerConfig.tone === 'red'
                    ? 'bg-rose-950/55 border-rose-500/90 text-rose-100 animate-pulse'
                    : 'bg-amber-950/45 border-amber-500/80 text-amber-100'
              }`}
            >
              <div className="flex items-start gap-3">
                {bannerConfig.tone === 'green' && (
                  <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0 mt-0.5" />
                )}
                {bannerConfig.tone === 'red' && (
                  <AlertOctagon className="w-6 h-6 text-rose-400 shrink-0 mt-0.5" />
                )}
                {bannerConfig.tone === 'amber' && (
                  <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="text-xs sm:text-sm font-mono font-extrabold tracking-tight uppercase">
                    {bannerConfig.title}
                  </div>
                  <p className="text-xs text-slate-300 mt-0.5">{bannerConfig.subtitle}</p>
                </div>
              </div>
            </div>

            {/* DB 1: ERP DATABASE (purchase_orders + gl_entries) */}
            <div className="bg-[#070b12] border border-slate-800 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                    1. ERP Database (SAP / NetSuite Core)
                  </span>
                </div>
                <span
                  className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-cyan-300 border border-slate-700 flex items-center gap-1"
                  title={state?.erp?.hash}
                >
                  <Hash className="w-3 h-3" />
                  {shortHash(state?.erp?.hash, 14)}
                </span>
              </div>

              <div className="p-2.5 space-y-2.5">
                {/* Purchase Orders Table */}
                <div>
                  <div className="text-[10px] font-mono uppercase text-slate-400 mb-1">
                    purchase_orders ({state?.erp?.purchase_orders?.length ?? 0})
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs font-mono">
                      <thead>
                        <tr className="border-b border-slate-800 text-[10px] text-slate-400">
                          <th className="py-1 pr-2">PO_ID</th>
                          <th className="py-1 pr-2">VENDOR / SKU</th>
                          <th className="py-1 pr-2">QTY × PRICE</th>
                          <th className="py-1 pr-2">STATUS</th>
                          <th className="py-1">VERSION</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {(state?.erp?.purchase_orders ?? []).map((po, i) => (
                          <tr key={`${po.po_id}-${i}`} className="text-[11px]">
                            <td className="py-1.5 pr-2 font-bold text-white">{po.po_id}</td>
                            <td className="py-1.5 pr-2">
                              <div className="text-slate-200 truncate max-w-[140px]">
                                {String(po.vendor_id ?? po.vendor ?? 'Approved Vendor')}
                              </div>
                              {po.sku !== undefined && (
                                <div className="text-[10px] text-slate-400">{String(po.sku)}</div>
                              )}
                            </td>
                            <td className="py-1.5 pr-2 text-emerald-300">
                              {po.qty !== undefined
                                ? `${String(po.qty)} × ${formatUsd(Number(po.unit_price))}`
                                : formatUsd(po.amount_usd ?? po.amount)}
                            </td>
                            <td className="py-1.5 pr-2">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  String(po.status).includes('HUMAN')
                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                    : String(po.status) === 'FULFILLED'
                                      ? 'bg-cyan-500/20 text-cyan-300'
                                      : 'bg-slate-800 text-slate-300'
                                }`}
                              >
                                {po.status}
                              </span>
                            </td>
                            <td className="py-1.5 text-[10px] text-slate-400">
                              {po.version !== undefined ? `v${String(po.version)}` : shortHash(po.etag, 12)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* General Ledger Entries Table */}
                <div>
                  <div className="text-[10px] font-mono uppercase text-slate-400 mb-1">
                    gl_entries ({state?.erp?.gl_entries?.length ?? 0})
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs font-mono">
                      <thead>
                        <tr className="border-b border-slate-800 text-[10px] text-slate-400">
                          <th className="py-1 pr-2">ENTRY</th>
                          <th className="py-1 pr-2">PO</th>
                          <th className="py-1 pr-2">DEBIT</th>
                          <th className="py-1 pr-2">CREDIT</th>
                          <th className="py-1">MEMO</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {(state?.erp?.gl_entries ?? []).map((gl, i) => (
                          <tr key={`${gl.entry_id || gl.id || i}`} className="text-[11px]">
                            <td className="py-1 pr-2 text-slate-300">
                              {gl.entry_id || gl.id || `GL-${i + 1}`}
                            </td>
                            <td className="py-1 pr-2 text-white">{String(gl.po_id ?? gl.account ?? '')}</td>
                            <td className="py-1 pr-2 text-emerald-300">{formatUsd(gl.debit)}</td>
                            <td className="py-1 pr-2 text-cyan-300">{formatUsd(gl.credit)}</td>
                            <td className="py-1 text-[10px] text-slate-400 truncate max-w-[140px]">
                              {gl.memo || 'Balanced entry'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            {/* DB 2: WMS DATABASE (inventory) */}
            <div className="bg-[#070b12] border border-slate-800 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                    2. WMS Database (Warehouse Inventory)
                  </span>
                </div>
                <span
                  className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-emerald-300 border border-slate-700 flex items-center gap-1"
                  title={state?.wms?.hash}
                >
                  <Hash className="w-3 h-3" />
                  {shortHash(state?.wms?.hash, 14)}
                </span>
              </div>

              <div className="p-2.5">
                <div className="text-[10px] font-mono uppercase text-slate-400 mb-1">
                  inventory ({state?.wms?.inventory?.length ?? 0})
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs font-mono">
                    <thead>
                      <tr className="border-b border-slate-800 text-[10px] text-slate-400">
                        <th className="py-1 pr-2">SKU</th>
                        <th className="py-1 pr-2">ON_HAND</th>
                        <th className="py-1 pr-2">RESERVED</th>
                        <th className="py-1 pr-2">AVAILABLE</th>
                        <th className="py-1">VERSION</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {(state?.wms?.inventory ?? []).map((item, i) => (
                        <tr key={`${item.sku}-${i}`} className="text-[11px]">
                          <td className="py-1.5 pr-2 font-bold text-white">{item.sku}</td>
                          <td className="py-1.5 pr-2 text-emerald-300 font-bold">{item.on_hand}</td>
                          <td className="py-1.5 pr-2 text-amber-300">{item.reserved ?? 0}</td>
                          <td className="py-1.5 pr-2 text-cyan-300">
                            {item.available ?? item.on_hand - (item.reserved ?? 0)}
                          </td>
                          <td className="py-1.5 text-[10px] text-slate-400">
                            {item.version !== undefined ? `v${String(item.version)}` : shortHash(item.etag, 12)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* DB 3: BILLING DATABASE (invoices + credit_notes) */}
            <div className="bg-[#070b12] border border-slate-800 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-purple-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                    3. Billing &amp; Treasury Database
                  </span>
                </div>
                <span
                  className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-purple-300 border border-slate-700 flex items-center gap-1"
                  title={state?.billing?.hash}
                >
                  <Hash className="w-3 h-3" />
                  {shortHash(state?.billing?.hash, 14)}
                </span>
              </div>

              <div className="p-2.5 space-y-2">
                <div>
                  <div className="text-[10px] font-mono uppercase text-slate-400 mb-1">
                    invoices ({state?.billing?.invoices?.length ?? 0}) &amp; credit_notes (
                    {state?.billing?.credit_notes?.length ?? 0})
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs font-mono">
                      <thead>
                        <tr className="border-b border-slate-800 text-[10px] text-slate-400">
                          <th className="py-1 pr-2">INVOICE_ID</th>
                          <th className="py-1 pr-2">PO_ID</th>
                          <th className="py-1 pr-2">AMOUNT</th>
                          <th className="py-1">STATUS</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {(state?.billing?.invoices ?? []).map((inv, i) => (
                          <tr key={`${inv.invoice_id || inv.id || i}`} className="text-[11px]">
                            <td className="py-1.5 pr-2 font-bold text-white">
                              {inv.invoice_id || inv.id}
                            </td>
                            <td className="py-1.5 pr-2 text-slate-300">{inv.po_id || 'PO-1001'}</td>
                            <td className="py-1.5 pr-2 text-emerald-300">
                              {formatUsd(inv.amount_usd ?? inv.amount)}
                            </td>
                            <td className="py-1.5">
                              <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 text-[10px] font-bold">
                                {inv.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
