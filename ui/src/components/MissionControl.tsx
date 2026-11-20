import type { DemoAct, ProxyEvent, RuntimeConfig, StatePayload, TxReceipt } from '../types';
import AgentPane from './AgentPane';
import LiveStatePane from './LiveStatePane';
import ShadowPane from './ShadowPane';

// Split-screen Mission Control: control bar on top, then
// Agent | Ablate proxy (shadow twin, gate, saga) | 3 live databases.

const ACT_BUTTONS: Array<{ id: DemoAct; label: string }> = [
  { id: 'act1_corruption', label: 'Act 1 · Crisis' },
  { id: 'act2_rollback', label: 'Act 2 · Rollback' },
  { id: 'act3_injection', label: 'Act 3 · Injection' },
  { id: 'act4_etag_conflict', label: 'Act 4 · ETag guard' },
];

function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-1.5 text-[13px] hover:bg-paper">
      {label}
      <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${on ? 'bg-ink text-white' : 'bg-[#e5e7eb] text-muted'}`}>{on ? 'ON' : 'OFF'}</span>
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
}) {
  const { events, receipts, state, config, running } = props;
  // The current transaction is the most recent TX_BEGIN in the stream.
  const begin = [...events].reverse().find((e) => e.type === 'TX_BEGIN');
  const txId = begin?.tx_id ?? null;
  const txEvents = txId ? events.filter((e) => e.tx_id === txId) : [];
  const receipt = txId ? receipts.find((r) => r.tx_id === txId) ?? null : null;
  const preHashes = (begin?.data as { pre_tx_hashes?: Record<string, string> } | undefined)?.pre_tx_hashes ?? null;
  const inFlight = !!txId && !receipt;
  const aegis = receipt ? !!receipt.aegis_enabled : config.aegis_enabled;

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-3 px-4 py-4 lg:h-[calc(100vh-56px-49px)]">
      <div className="flex flex-wrap items-center gap-2">
        <Toggle on={config.aegis_enabled} label="Ablate" onClick={() => props.onConfig({ aegis_enabled: !config.aegis_enabled })} />
        <Toggle on={config.fail_billing_409} label="Billing 409 fault" onClick={() => props.onConfig({ fail_billing_409: !config.fail_billing_409 })} />
        <Toggle on={config.simulate_human_edit} label="Human edit" onClick={() => props.onConfig({ simulate_human_edit: !config.simulate_human_edit })} />
        <button onClick={props.onReset} disabled={!!running} className="rounded-lg border border-line bg-white px-3 py-1.5 text-[13px] hover:bg-paper disabled:opacity-50">
          {running === 'reset' ? 'Resetting…' : 'Reset all 3 DBs'}
        </button>
        <span className="mx-1 hidden h-6 w-px bg-line sm:block" />
        {ACT_BUTTONS.map((a) => (
          <button
            key={a.id}
            onClick={() => props.onRun(a.id)}
            disabled={!!running}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-40 ${running === a.id ? 'bg-[#1d4ed8] text-white' : 'bg-ink text-white hover:bg-black'}`}
          >
            {running === a.id ? 'Running…' : a.label}
          </button>
        ))}
        <span className="ml-auto font-mono text-[12px] text-muted">{txId ?? 'no transaction'}</span>
      </div>
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_1.15fr_1.15fr]">
        <div className="flex min-h-[420px] lg:min-h-0">
          <div className="flex w-full min-h-0 flex-col [&>section]:flex-1">
            <AgentPane events={txEvents} />
          </div>
        </div>
        <div className="flex min-h-[420px] lg:min-h-0">
          <div className="flex w-full min-h-0 flex-col [&>section]:flex-1">
            <ShadowPane events={txEvents} receipt={receipt} aegis={aegis} />
          </div>
        </div>
        <div className="flex min-h-[420px] lg:min-h-0">
          <div className="flex w-full min-h-0 flex-col [&>section]:flex-1">
            <LiveStatePane state={state} receipt={receipt} preHashes={preHashes} inFlight={inFlight} />
          </div>
        </div>
      </div>
    </div>
  );
}
