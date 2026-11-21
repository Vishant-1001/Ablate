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

const STEPS: Array<{ n: number; short: string; detail: string }> = [
  {
    n: 1,
    short: 'Step 1 · Read Records',
    detail: 'AI Assistant reads Order #1042 (500 boxes), Warehouse (500 reserved), and Invoice #88 ($50,000).',
  },
  {
    n: 2,
    short: 'Step 2 · Propose Updates',
    detail: 'AI Assistant proposes reducing Order & Warehouse to 480 boxes and issuing a $2,000 refund credit.',
  },
  {
    n: 3,
    short: 'Step 3 · Safe Sandbox',
    detail: 'Ablate captures the proposed updates inside the Staging Sandbox (0 live databases touched).',
  },
  {
    n: 4,
    short: 'Step 4 · Check 5 Rules',
    detail: 'Ablate verifies all 5 company safety rules with zero AI guesswork.',
  },
  {
    n: 5,
    short: 'Step 5 · Apply & Fault',
    detail: 'Orders & Warehouse update to 480 boxes… then Billing fails (Invoice #88 is locked)!',
  },
  {
    n: 6,
    short: 'Step 6 · Final Result',
    detail: 'Final state across all 3 company databases.',
  },
];

export default function MissionControl(props: {
  events: ProxyEvent[];
  receipts: TxReceipt[];
  state: StatePayload | null;
  config: RuntimeConfig;
  running: string | null;
  stage: number;
  onSetStage: (s: number) => void;
  onRun: (a: DemoAct) => void;
  onConfig: (p: Partial<RuntimeConfig>) => void;
  onReset: () => void;
  onOpenTx?: (txId: string) => void;
}) {
  const { events, receipts, state, config, running, stage } = props;
  const latestReceipt = receipts.length ? receipts[receipts.length - 1] : null;
  const begin = [...events].reverse().find((e) => e.type === 'TX_BEGIN');
  const txId = begin?.tx_id ?? latestReceipt?.tx_id ?? null;
  const txEvents = txId ? events.filter((e) => e.tx_id === txId) : [];
  const receipt = txId ? receipts.find((r) => r.tx_id === txId) ?? null : null;
  const aegis = receipt ? !!receipt.aegis_enabled : config.aegis_enabled;

  const activeScenario = SCENARIOS.find((s) => s.expect === receipt?.status) ?? null;
  const v = verdictOf(receipt?.status);
  const currentStepInfo = STEPS.find((st) => st.n === stage);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-line bg-paper p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#1d4ed8]">
              Step-by-Step Interactive Simulator
            </div>
            <h2 className="mt-0.5 text-[18px] font-bold text-ink">
              Business Case: 480 Boxes Delivered Instead of 500 ($2,000 Refund Needed Across 3 Systems)
            </h2>
          </div>

          <button
            onClick={props.onReset}
            disabled={!!running}
            className="rounded-lg border border-line bg-white px-3.5 py-1.5 text-[12px] font-medium hover:bg-[#f3f4f6] disabled:opacity-50"
          >
            {running === 'reset' ? 'Resetting…' : 'Reset All Systems to 500 Boxes'}
          </button>
        </div>

        {/* 4 Simple Scenario Cards */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SCENARIOS.map((s) => {
            const sv = verdictOf(s.expect);
            const isSelected = receipt?.status === s.expect;
            const isRunningThis = running === s.id;
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
                  disabled={!!running}
                  className={`mt-3 w-full rounded-lg px-3 py-2 text-[13px] font-semibold transition disabled:opacity-50 ${
                    isRunningThis || isSelected
                      ? 'bg-[#1d4ed8] text-white hover:bg-[#1e40af]'
                      : 'bg-ink text-white hover:bg-black'
                  }`}
                >
                  {isRunningThis ? 'Loading Scenario…' : isSelected ? `Restart Scenario ${s.n}` : `Load Scenario ${s.n}`}
                </button>
              </div>
            );
          })}
        </div>

        {/* Manual Step-by-Step Navigation Bar (Always Visible, Zero Auto-Advance) */}
        <div className="mt-3.5 rounded-xl border border-line bg-white p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => props.onSetStage(Math.max(1, (stage || 1) - 1))}
                disabled={!receipt || stage <= 1}
                className="rounded-lg border border-line bg-paper px-3.5 py-2 text-[13px] font-semibold text-ink hover:bg-[#e5e7eb] disabled:opacity-40"
              >
                ← Previous Step
              </button>
              <button
                onClick={() => props.onSetStage(Math.min(6, (stage || 0) + 1))}
                disabled={!receipt || stage >= 6}
                className="rounded-lg bg-[#1d4ed8] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#1e40af] disabled:opacity-40"
              >
                Next Step →
              </button>
            </div>

            {/* 6 Clickable Step Pills */}
            <div className="flex flex-wrap items-center gap-1.5">
              {STEPS.map((st) => {
                const active = Boolean(receipt) && stage === st.n;
                const done = Boolean(receipt) && stage > st.n;
                return (
                  <button
                    key={st.n}
                    disabled={!receipt}
                    onClick={() => props.onSetStage(st.n)}
                    className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition disabled:opacity-50 ${
                      active
                        ? 'bg-[#1d4ed8] text-white shadow-sm'
                        : done
                          ? 'bg-[#e3f2e8] text-[#14532d] hover:bg-[#cce5d5]'
                          : 'bg-[#f3f4f6] text-muted hover:bg-[#e5e7eb]'
                    }`}
                  >
                    {st.short}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Current Step Explanation Line */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5">
            <div className="flex items-center gap-2.5 text-[13px]">
              <span
                className={`rounded-md px-2.5 py-0.5 text-[11px] font-bold ${
                  !receipt || stage === 0
                    ? 'bg-[#f3f4f6] text-[#374151]'
                    : stage < 6
                      ? 'bg-[#eef4ff] text-[#1d4ed8]'
                      : v.block
                }`}
              >
                {!receipt || stage === 0 ? 'SELECT A SCENARIO' : stage < 6 ? `STEP ${stage} OF 6` : v.label}
              </span>
              <span className="font-medium text-ink">
                {!receipt || stage === 0
                  ? 'Load any scenario above (1–4), then use "Next Step →" and "← Previous Step" to walk through each stage at your own pace.'
                  : stage < 6
                    ? currentStepInfo?.detail
                    : activeScenario
                      ? activeScenario.plainSummary
                      : v.line}
              </span>
            </div>
            {receipt && stage >= 6 && props.onOpenTx && (
              <button
                onClick={() => props.onOpenTx?.(receipt.tx_id)}
                className="text-[13px] font-semibold text-[#1d4ed8] underline"
              >
                Open Detailed Report →
              </button>
            )}
          </div>
        </div>
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
            <AgentPane
              events={txEvents}
              receipt={receipt}
              stage={receipt ? stage : 0}
              onSetStage={props.onSetStage}
            />
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
            <ShadowPane
              events={txEvents}
              receipt={receipt}
              aegis={aegis}
              stage={receipt ? stage : 0}
              onSetStage={props.onSetStage}
            />
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
            <LiveStatePane
              state={state}
              receipt={receipt}
              stage={receipt ? stage : 0}
              onSetStage={props.onSetStage}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
