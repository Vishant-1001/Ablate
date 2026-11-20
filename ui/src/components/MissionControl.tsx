import type { DemoAct, ProxyEvent, RuntimeConfig, StatePayload, TxReceipt, TxStatus } from '../types';
import AgentPane from './AgentPane';
import LiveStatePane from './LiveStatePane';
import ShadowPane from './ShadowPane';
import { fmtMs, verdictOf } from './ui';

const SCENARIOS: Array<{
  id: DemoAct;
  n: number;
  title: string;
  subtitle: string;
  whatHappens: string;
  expect: TxStatus;
}> = [
  {
    id: 'act1_corruption',
    n: 1,
    title: 'Without Ablate (Direct API)',
    subtitle: 'Protection Off · Billing fails on step 4',
    whatHappens:
      'The AI agent reduced ERP Order #1042 (500 → 480 units) and Warehouse Stock (500 → 480 units), then Billing rejected the $2,000 credit note because Invoice #88 is locked. Without Ablate, ERP and Warehouse remain permanently mismatched ($2,000 discrepancy).',
    expect: 'PARTIAL_CORRUPTION',
  },
  {
    id: 'act2_rollback',
    n: 2,
    title: 'With Ablate: Auto-Rollback',
    subtitle: 'Protection On · Automatic multi-system undo',
    whatHappens:
      'Ablate staged all 4 changes safely and verified every company policy. When Billing rejected the credit note on step 4, Ablate automatically reversed the Ledger, Warehouse (+20 units), and ERP updates in ~2 milliseconds—leaving all 3 systems 100% restored at 500 units.',
    expect: 'ROLLED_BACK_CLEANLY',
  },
  {
    id: 'act3_injection',
    n: 3,
    title: 'Fraudulent Wire Blocked',
    subtitle: 'Protection On · Tampered invoice requests $12k wire',
    whatHappens:
      'A manipulated note inside the supplier invoice tried to trick the agent into wiring $12,000 to an unverified bank account. Ablate caught the approval limit ($12,000 > $5,000), unapproved bank IBAN, and untrusted source inside the staging sandbox—zero live systems were touched.',
    expect: 'ABORTED_IN_SHADOW',
  },
  {
    id: 'act4_etag_conflict',
    n: 4,
    title: 'Human Manager Edit Saved',
    subtitle: 'Protection On · Manager edits order to 470 mid-run',
    whatHappens:
      'While the agent was running, a human operations manager updated Order #1042 to 470 units. When Billing failed on step 4, Ablate rolled back the Warehouse and Ledger updates, detected the manager’s edit on Order #1042, and preserved the manager’s 470-unit change instead of overwriting it.',
    expect: 'QUARANTINED_CONCURRENT_EDIT',
  },
];

function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-1.5 text-[13px] hover:bg-paper"
    >
      {label}
      <span
        className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
          on ? 'bg-ink text-white' : 'bg-[#e5e7eb] text-muted'
        }`}
      >
        {on ? 'ON' : 'OFF'}
      </span>
    </button>
  );
}

export default function MissionControl(props: {
  events: ProxyEvent[];
  receipts: TxReceipt[];
  state: StatePayload | null;
  config: RuntimeConfig;
  running: string | null;
  onRun: (a: DemoAct) => void;
  onConfig: (p: Partial<RuntimeConfig>) => void;
  onReset: () => void;
  onOpenTx?: (txId: string) => void;
}) {
  const { events, receipts, state, config, running } = props;
  const latestReceipt = receipts.length ? receipts[receipts.length - 1] : null;
  const begin = [...events].reverse().find((e) => e.type === 'TX_BEGIN');
  const txId = begin?.tx_id ?? latestReceipt?.tx_id ?? null;
  const txEvents = txId ? events.filter((e) => e.tx_id === txId) : [];
  const receipt = txId ? receipts.find((r) => r.tx_id === txId) ?? null : null;
  const preHashes =
    receipt?.pre_tx_hashes ??
    (begin?.data as { pre_tx_hashes?: Record<string, string> } | undefined)?.pre_tx_hashes ??
    null;
  const inFlight = !!txId && !receipt;
  const aegis = receipt ? !!receipt.aegis_enabled : config.aegis_enabled;

  const activeScenario = SCENARIOS.find((s) => s.expect === receipt?.status) ?? null;
  const v = verdictOf(receipt?.status);

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-4 py-5">
      <div className="rounded-xl border border-line bg-paper p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#1d4ed8]">
              Interactive Enterprise Sandbox · Live 3-System Workflow
            </div>
            <h1 className="mt-0.5 text-[20px] font-bold text-ink">
              Live Case: Reconciling a 20-Unit ($2,000) Shipment Shortage Across ERP, Warehouse &amp; Billing
            </h1>
            <p className="mt-0.5 text-[13px] text-[#374151]">
              Purchase Order <span className="font-semibold">PO-1042</span> ordered{' '}
              <span className="font-semibold">500 units</span> ($50,000), but only{' '}
              <span className="font-semibold">480 units</span> arrived at the warehouse. Click any scenario below to
              compare how a standard AI agent fails versus how <span className="font-semibold">Ablate</span> protects
              production:
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Toggle
              on={config.aegis_enabled}
              label="Ablate Protection"
              onClick={() => props.onConfig({ aegis_enabled: !config.aegis_enabled })}
            />
            <Toggle
              on={config.fail_billing_409}
              label="Simulate Billing Lock"
              onClick={() => props.onConfig({ fail_billing_409: !config.fail_billing_409 })}
            />
            <Toggle
              on={config.simulate_human_edit}
              label="Simulate Manager Edit"
              onClick={() => props.onConfig({ simulate_human_edit: !config.simulate_human_edit })}
            />
            <button
              onClick={props.onReset}
              disabled={!!running}
              className="rounded-lg border border-line bg-white px-3 py-1.5 text-[13px] font-medium hover:bg-[#f3f4f6] disabled:opacity-50"
            >
              {running === 'reset' ? 'Resetting…' : 'Reset All Systems to 500 Units'}
            </button>
          </div>
        </div>

        <div className="mt-3.5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SCENARIOS.map((s) => {
            const sv = verdictOf(s.expect);
            const isSelected = receipt?.status === s.expect;
            return (
              <div
                key={s.id}
                className={`flex flex-col justify-between rounded-xl border bg-white p-3.5 transition ${
                  isSelected ? 'border-ink ring-1 ring-ink' : 'border-line'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">
                      Scenario {s.n}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold tracking-[0.04em] ${sv.pill}`}>
                      {sv.label}
                    </span>
                  </div>
                  <div className="mt-1 text-[15px] font-bold text-ink">{s.title}</div>
                  <div className="mt-0.5 text-[12px] text-muted">{s.subtitle}</div>
                </div>
                <button
                  onClick={() => props.onRun(s.id)}
                  disabled={!!running}
                  className={`mt-3 w-full rounded-lg px-3 py-2 text-[13px] font-semibold transition disabled:opacity-40 ${
                    running === s.id
                      ? 'bg-[#1d4ed8] text-white'
                      : isSelected
                        ? 'bg-[#1d4ed8] text-white hover:bg-[#1e40af]'
                        : 'bg-ink text-white hover:bg-black'
                  }`}
                >
                  {running === s.id ? 'Running Scenario…' : `Run Scenario ${s.n}`}
                </button>
              </div>
            );
          })}
        </div>

        {receipt && (
          <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white px-4 py-3">
            <div className="flex flex-1 items-start gap-3">
              <span className={`mt-0.5 shrink-0 rounded-md px-2.5 py-1 text-[12px] font-bold ${v.block}`}>
                {v.label}
              </span>
              <div className="text-[13px] leading-snug text-[#374151]">
                <span className="font-bold text-ink">
                  {activeScenario ? `What Just Happened (${activeScenario.title}): ` : `${v.title}: `}
                </span>
                {activeScenario ? activeScenario.whatHappens : v.line}
              </div>
            </div>
            <div className="flex items-center gap-3 text-[12px] text-muted">
              {receipt.rollback_ms != null && (
                <span className="font-semibold text-[#14532d]">Restored in {fmtMs(receipt.rollback_ms)}</span>
              )}
              {props.onOpenTx && (
                <button
                  onClick={() => props.onOpenTx?.(receipt.tx_id)}
                  className="text-[13px] font-semibold text-[#1d4ed8] underline"
                >
                  View Audit Report →
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_1.15fr_1.15fr]">
        <div className="flex flex-col">
          <div className="mb-1.5 flex items-center gap-2 px-1 text-[12px] font-bold uppercase tracking-[0.04em] text-ink">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-white">
              1
            </span>
            Step 1 · AI Agent Requests Multi-System Updates
          </div>
          <div className="flex min-h-[440px] flex-col [&>section]:flex-1">
            <AgentPane events={txEvents} />
          </div>
        </div>

        <div className="flex flex-col">
          <div className="mb-1.5 flex items-center gap-2 px-1 text-[12px] font-bold uppercase tracking-[0.04em] text-ink">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#1d4ed8] text-[11px] font-bold text-white">
              2
            </span>
            Step 2 · Ablate Stages, Verifies Policies &amp; Auto-Reverts on Failure
          </div>
          <div className="flex min-h-[440px] flex-col [&>section]:flex-1">
            <ShadowPane events={txEvents} receipt={receipt} aegis={aegis} />
          </div>
        </div>

        <div className="flex flex-col">
          <div className="mb-1.5 flex items-center gap-2 px-1 text-[12px] font-bold uppercase tracking-[0.04em] text-ink">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#15803d] text-[11px] font-bold text-white">
              3
            </span>
            Step 3 · Live Enterprise Databases (ERP · Warehouse · Billing)
          </div>
          <div className="flex min-h-[440px] flex-col [&>section]:flex-1">
            <LiveStatePane state={state} receipt={receipt} preHashes={preHashes} inFlight={inFlight} />
          </div>
        </div>
      </div>
    </div>
  );
}
