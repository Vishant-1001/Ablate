import type { DemoAct, ProxyEvent, RuntimeConfig, StatePayload, TxReceipt, TxStatus } from '../types';
import AgentPane from './AgentPane';
import LiveStatePane from './LiveStatePane';
import ShadowPane from './ShadowPane';
import { verdictOf } from './ui';

const SCENARIOS: Array<{
  id: DemoAct;
  n: number;
  title: string;
  subtitle: string;
  plainSummary: string;
  expect: TxStatus;
}> = [
  {
    id: 'act1_corruption',
    n: 1,
    title: '1. Without Ablate',
    subtitle: 'Billing fails → Databases stay corrupted',
    plainSummary:
      'Orders and Warehouse dropped from 500 to 480 boxes, then Billing failed. Without Ablate, your databases remain permanently out of sync ($2,000 error).',
    expect: 'PARTIAL_CORRUPTION',
  },
  {
    id: 'act2_rollback',
    n: 2,
    title: '2. With Ablate: Auto-Undo',
    subtitle: 'Billing fails → Instant rollback to 500',
    plainSummary:
      'Orders and Warehouse updated to 480 boxes, then Billing failed. Ablate automatically reversed both updates back to 500 boxes in ~2 milliseconds.',
    expect: 'ROLLED_BACK_CLEANLY',
  },
  {
    id: 'act3_injection',
    n: 3,
    title: '3. Fraudulent Wire Blocked',
    subtitle: 'Fake invoice note asks for $12k wire',
    plainSummary:
      'A tampered invoice tried to trick the AI into wiring $12,000 to an unapproved bank account. Ablate blocked it in the sandbox before any database was touched.',
    expect: 'ABORTED_IN_SHADOW',
  },
  {
    id: 'act4_etag_conflict',
    n: 4,
    title: '4. Human Manager Edit Saved',
    subtitle: 'Manager edits order to 470 mid-run',
    plainSummary:
      'A human manager changed Order #1042 to 470 boxes while the AI was running. When Billing failed, Ablate undid Warehouse back to 500 while preserving the manager’s 470-box edit.',
    expect: 'QUARANTINED_CONCURRENT_EDIT',
  },
];

const STAGE_LABELS: Record<number, string> = {
  1: 'Step 1 of 4 · AI Assistant reading Order #1042 and proposing updates…',
  2: 'Step 2 of 4 · Ablate staging changes and checking 5 company safety rules…',
  3: 'Step 3 of 4 · Applying updates (500 → 480 boxes)… Billing fails on Invoice #88!',
  4: 'Step 4 of 4 · Complete',
};

export default function MissionControl(props: {
  events: ProxyEvent[];
  receipts: TxReceipt[];
  state: StatePayload | null;
  config: RuntimeConfig;
  running: string | null;
  stage?: number;
  onRun: (a: DemoAct) => void;
  onConfig: (p: Partial<RuntimeConfig>) => void;
  onReset: () => void;
  onOpenTx?: (txId: string) => void;
}) {
  const { events, receipts, state, config, running, stage = 4 } = props;
  const latestReceipt = receipts.length ? receipts[receipts.length - 1] : null;
  const begin = [...events].reverse().find((e) => e.type === 'TX_BEGIN');
  const txId = begin?.tx_id ?? latestReceipt?.tx_id ?? null;
  const txEvents = txId ? events.filter((e) => e.tx_id === txId) : [];
  const receipt = txId ? receipts.find((r) => r.tx_id === txId) ?? null : null;
  const aegis = receipt ? !!receipt.aegis_enabled : config.aegis_enabled;

  const activeScenario = SCENARIOS.find((s) => s.expect === receipt?.status) ?? null;
  const v = verdictOf(receipt?.status);
  const animating = stage > 0 && stage < 4;

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-4 py-5">
      <div className="rounded-xl border border-line bg-paper p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#1d4ed8]">
              Interactive Live Demo
            </div>
            <h1 className="mt-0.5 text-[19px] font-bold text-ink">
              Scenario: 480 Boxes Delivered Instead of 500 ($2,000 Refund Needed Across 3 Systems)
            </h1>
          </div>
          <button
            onClick={props.onReset}
            disabled={!!running || animating}
            className="rounded-lg border border-line bg-white px-3.5 py-1.5 text-[13px] font-medium hover:bg-[#f3f4f6] disabled:opacity-50"
          >
            {running === 'reset' ? 'Resetting…' : 'Reset All Systems to 500 Boxes'}
          </button>
        </div>

        {/* 4 Simple Scenario Cards */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SCENARIOS.map((s) => {
            const sv = verdictOf(s.expect);
            const isSelected = receipt?.status === s.expect && stage === 4;
            const isRunningThis = running === s.id || (animating && receipt?.status === s.expect);
            return (
              <div
                key={s.id}
                className={`flex flex-col justify-between rounded-xl border bg-white p-3.5 transition ${
                  isSelected || isRunningThis ? 'border-ink ring-1 ring-ink' : 'border-line'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[14px] font-bold text-ink">{s.title}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${sv.pill}`}>{sv.label}</span>
                  </div>
                  <div className="mt-1 text-[12px] text-muted">{s.subtitle}</div>
                </div>
                <button
                  onClick={() => props.onRun(s.id)}
                  disabled={!!running || animating}
                  className={`mt-3 w-full rounded-lg px-3 py-2 text-[13px] font-semibold transition disabled:opacity-50 ${
                    isRunningThis
                      ? 'bg-[#1d4ed8] text-white'
                      : isSelected
                        ? 'bg-[#1d4ed8] text-white hover:bg-[#1e40af]'
                        : 'bg-ink text-white hover:bg-black'
                  }`}
                >
                  {isRunningThis ? 'Playing Step-by-Step…' : `Run Scenario ${s.n}`}
                </button>
              </div>
            );
          })}
        </div>

        {/* Live Step-by-Step Progress Bar or Final Plain-English Takeaway */}
        {animating && (
          <div className="mt-3.5 rounded-lg border border-[#1d4ed8]/30 bg-[#eef4ff] px-4 py-3">
            <div className="flex items-center justify-between text-[13px] font-bold text-[#1d4ed8]">
              <span>{STAGE_LABELS[stage]}</span>
              <span>Step {stage} / 3</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white">
              <div
                className="h-full bg-[#1d4ed8] transition-all duration-500"
                style={{ width: `${(stage / 3) * 100}%` }}
              />
            </div>
          </div>
        )}

        {!animating && receipt && (
          <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white px-4 py-3">
            <div className="flex flex-1 items-center gap-3">
              <span className={`shrink-0 rounded-md px-2.5 py-1 text-[12px] font-bold ${v.block}`}>{v.label}</span>
              <span className="text-[13px] font-medium text-ink">
                {activeScenario ? activeScenario.plainSummary : v.line}
              </span>
            </div>
            {props.onOpenTx && (
              <button
                onClick={() => props.onOpenTx?.(receipt.tx_id)}
                className="text-[13px] font-semibold text-[#1d4ed8] underline"
              >
                View Audit Report →
              </button>
            )}
          </div>
        )}
      </div>

      {/* 3 Simple Columns */}
      <div className="grid gap-3 lg:grid-cols-[1fr_1.15fr_1.15fr]">
        <div className="flex flex-col">
          <div className="mb-1.5 flex items-center gap-2 px-1 text-[12px] font-bold uppercase text-ink">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-white">
              1
            </span>
            AI Assistant Requests Changes
          </div>
          <div className="flex min-h-[420px] flex-col [&>section]:flex-1">
            <AgentPane events={txEvents} stage={stage} />
          </div>
        </div>

        <div className="flex flex-col">
          <div className="mb-1.5 flex items-center gap-2 px-1 text-[12px] font-bold uppercase text-ink">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#1d4ed8] text-[11px] font-bold text-white">
              2
            </span>
            Ablate Checks Rules &amp; Auto-Undoes Errors
          </div>
          <div className="flex min-h-[420px] flex-col [&>section]:flex-1">
            <ShadowPane events={txEvents} receipt={receipt} aegis={aegis} stage={stage} />
          </div>
        </div>

        <div className="flex flex-col">
          <div className="mb-1.5 flex items-center gap-2 px-1 text-[12px] font-bold uppercase text-ink">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#15803d] text-[11px] font-bold text-white">
              3
            </span>
            Live Company Databases (Orders · Warehouse · Billing)
          </div>
          <div className="flex min-h-[420px] flex-col [&>section]:flex-1">
            <LiveStatePane state={state} receipt={receipt} stage={stage} />
          </div>
        </div>
      </div>
    </div>
  );
}
