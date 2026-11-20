import type { ProxyEvent } from '../types';
import { friendlyArgs, friendlyToolName } from './ui';

// Left pane: plain-English business view of every action the AI Agent takes.

const SHOWN = new Set(['TOOL_CALL', 'TAINT_VIOLATION', 'LIVE_FAILED']);

export default function AgentPane({ events }: { events: ProxyEvent[] }) {
  const rows = events.filter((e) => SHOWN.has(e.type));
  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-line bg-white">
      <header className="border-b border-line px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-bold">AI Operations Agent</h2>
          <span className="rounded bg-[#eef4ff] px-2 py-0.5 text-[11px] font-semibold text-[#1d4ed8]">
            Google Gemini · ADK
          </span>
        </div>
        <div className="mt-0.5 text-[12px] text-muted">
          Automated steps requested by the agent to resolve the shipment discrepancy
        </div>
      </header>
      <ol className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3.5">
        {rows.length === 0 && (
          <li className="rounded-lg border border-dashed border-line p-5 text-center text-[13px] text-muted">
            Select a scenario above to watch the AI agent process Purchase Order #1042 across ERP, Warehouse, and Billing.
          </li>
        )}
        {rows.map((e, i) => {
          const d = (e.data ?? {}) as Record<string, unknown>;
          if (e.type === 'TOOL_CALL') {
            const parts = e.message.split(' called ');
            const rawTool = parts[1] ?? e.message;
            const args = (d.args ?? {}) as Record<string, unknown>;
            const isRead = rawTool.includes('.get_');
            const isCommit = rawTool.includes('commit_tx');
            return (
              <li
                key={i}
                className={`rounded-lg border px-3.5 py-2.5 ${
                  isCommit
                    ? 'border-[#1d4ed8]/30 bg-[#eef4ff]/60'
                    : isRead
                      ? 'border-line bg-white'
                      : 'border-line bg-paper'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-bold text-ink">{friendlyToolName(rawTool)}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                      isCommit
                        ? 'bg-[#1d4ed8] text-white'
                        : isRead
                          ? 'bg-[#f3f4f6] text-muted'
                          : 'bg-ink text-white'
                    }`}
                  >
                    {isCommit ? 'Commit' : isRead ? 'Read' : 'Write Action'}
                  </span>
                </div>
                <div className="mt-1 text-[12px] text-[#374151]">{friendlyArgs(rawTool, args)}</div>
              </li>
            );
          }
          if (e.type === 'TAINT_VIOLATION') {
            return (
              <li key={i} className="rounded-lg border border-[#f0d3cf] bg-[#fffbfa] px-3.5 py-2.5 text-[12px]">
                <div className="font-bold text-danger">Security Interception — Unauthorized Instruction Blocked</div>
                <div className="mt-1 text-[#374151]">
                  Ablate detected that an external invoice note attempted to redirect funds to an unapproved bank
                  account and blocked the request.
                </div>
              </li>
            );
          }
          if (e.type === 'LIVE_FAILED') {
            return (
              <li key={i} className="rounded-lg border border-[#f0d3cf] bg-[#fffbfa] px-3.5 py-2.5 text-[12px]">
                <div className="font-bold text-danger">Billing System Error (Invoice Locked)</div>
                <div className="mt-0.5 text-[#374151]">
                  Billing rejected the $2,000 credit note because Invoice #88 is locked by a nightly batch cycle.
                </div>
              </li>
            );
          }
          return null;
        })}
      </ol>
    </section>
  );
}
