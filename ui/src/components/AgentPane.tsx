import type { ProxyEvent } from '../types';
import { friendlyArgs, friendlyToolName } from './ui';

// Left pane: concise, layman-clear list of what the AI Assistant requests, revealed step-by-step.

const SHOWN = new Set(['TOOL_CALL', 'TAINT_VIOLATION', 'LIVE_FAILED']);

export default function AgentPane({ events, stage = 4 }: { events: ProxyEvent[]; stage?: number }) {
  const allRows = events.filter((e) => SHOWN.has(e.type));
  // Deduplicate repeated 409 retries in Act 1 so the list stays clean and concise
  const seenTools = new Set<string>();
  const rows = allRows.filter((e) => {
    if (e.type === 'TOOL_CALL') {
      const rawTool = e.message.split(' called ')[1] ?? e.message;
      if (rawTool === 'billing.issue_credit_note' && seenTools.has(rawTool)) return false;
      seenTools.add(rawTool);
    }
    return true;
  });

  const visibleRows =
    stage === 0
      ? []
      : stage === 1
        ? rows.filter((e) => e.type === 'TOOL_CALL' && e.message.includes('.get_'))
        : stage === 2
          ? rows.filter((e) => e.type !== 'LIVE_FAILED')
          : rows;

  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-line bg-white">
      <header className="border-b border-line px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-bold">AI Operations Assistant</h2>
          <span className="rounded bg-[#eef4ff] px-2 py-0.5 text-[11px] font-semibold text-[#1d4ed8]">
            Google Gemini
          </span>
        </div>
        <div className="text-[12px] text-muted">Actions requested by the AI to fix the 20-box shortage</div>
      </header>

      <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3.5">
        {visibleRows.length === 0 && (
          <li className="rounded-lg border border-dashed border-line p-6 text-center text-[13px] text-muted">
            Click a scenario above to watch the AI assistant run step by step.
          </li>
        )}
        {visibleRows.map((e, i) => {
          const d = (e.data ?? {}) as Record<string, unknown>;
          if (e.type === 'TOOL_CALL') {
            const rawTool = e.message.split(' called ')[1] ?? e.message;
            const args = (d.args ?? {}) as Record<string, unknown>;
            const isRead = rawTool.includes('.get_');
            const isCommit = rawTool.includes('commit_tx');
            return (
              <li
                key={i}
                className={`rounded-lg border px-3 py-2 transition-all duration-300 ${
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
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                      isCommit
                        ? 'bg-[#1d4ed8] text-white'
                        : isRead
                          ? 'bg-[#f3f4f6] text-muted'
                          : 'bg-ink text-white'
                    }`}
                  >
                    {isCommit ? 'Commit' : isRead ? 'Read' : 'Update'}
                  </span>
                </div>
                <div className="mt-0.5 text-[12px] text-[#374151]">{friendlyArgs(rawTool, args)}</div>
              </li>
            );
          }
          if (e.type === 'TAINT_VIOLATION') {
            return (
              <li key={i} className="rounded-lg border border-[#f0d3cf] bg-[#fffbfa] px-3 py-2 text-[12px]">
                <div className="font-bold text-danger">Blocked: Unauthorized $12,000 Bank Wire</div>
                <div className="mt-0.5 text-[#374151]">
                  Tampered invoice text tried to send $12,000 to an unapproved bank account.
                </div>
              </li>
            );
          }
          if (e.type === 'LIVE_FAILED') {
            return (
              <li key={i} className="rounded-lg border border-[#f0d3cf] bg-[#fffbfa] px-3 py-2 text-[12px]">
                <div className="font-bold text-danger">Billing Rejected $2,000 Credit Note</div>
                <div className="mt-0.5 text-[#374151]">Invoice #88 is locked by a nightly billing batch.</div>
              </li>
            );
          }
          return null;
        })}
      </ol>
    </section>
  );
}
