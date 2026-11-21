import type { ProxyEvent } from '../types';
import { friendlyArgs, friendlyToolName } from './ui';

// Left pane: 6-stage step-by-step reveal of the AI Assistant's actions.
// Stage 1: AI reads existing records (get_po, get_inventory, get_invoice)
// Stage 2+: AI proposes the write updates (update_po_qty, adjust_reservation, post_gl_adjustment, issue_credit_note/send_wire_payout)
// Stage 5+: Shows any rejection / security block response

const SHOWN = new Set(['TOOL_CALL', 'TAINT_VIOLATION', 'LIVE_FAILED']);

// Tool names arrive as "erp_get_po" (agent function names) or "erp.get_po" (MCP names).
function toolKind(rawTool: string): { isRead: boolean; isCommit: boolean } {
  return { isRead: /(^|[._])get_/.test(rawTool), isCommit: rawTool.includes('commit') };
}

export default function AgentPane({ events, stage = 6 }: { events: ProxyEvent[]; stage?: number }) {
  const allRows = events.filter((e) => SHOWN.has(e.type));
  const seenTools = new Set<string>();
  const rows = allRows.filter((e) => {
    if (e.type === 'TOOL_CALL') {
      const rawTool = e.message.split(' called ')[1] ?? e.message;
      if (rawTool === 'billing.issue_credit_note' && seenTools.has(rawTool)) return false;
      seenTools.add(rawTool);
    }
    return true;
  });

  const visibleRows = rows.filter((e) => {
    if (stage <= 0) return false;
    if (e.type === 'TOOL_CALL') {
      const rawTool = e.message.split(' called ')[1] ?? e.message;
      const { isRead, isCommit } = toolKind(rawTool);
      if (isRead) return stage >= 1;
      if (isCommit) return stage >= 3;
      return stage >= 2;
    }
    if (e.type === 'TAINT_VIOLATION') return stage >= 4;
    if (e.type === 'LIVE_FAILED') return stage >= 5;
    return stage >= 5;
  });

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
          const isLatest = i === visibleRows.length - 1 && stage < 6;
          if (e.type === 'TOOL_CALL') {
            const rawTool = e.message.split(' called ')[1] ?? e.message;
            const args = (d.args ?? {}) as Record<string, unknown>;
            const { isRead, isCommit } = toolKind(rawTool);
            return (
              <li
                key={i}
                className={`rounded-lg border px-3 py-2 transition-all duration-300 ${
                  isLatest
                    ? 'border-[#1d4ed8] bg-[#eef4ff] ring-1 ring-[#1d4ed8]'
                    : isCommit
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
                    {isCommit ? 'Commit' : isRead ? 'Step 1 · Read' : 'Step 2 · Update'}
                  </span>
                </div>
                <div className="mt-0.5 text-[12px] text-[#374151]">{friendlyArgs(rawTool, args)}</div>
              </li>
            );
          }
          if (e.type === 'TAINT_VIOLATION') {
            return (
              <li key={i} className="rounded-lg border-2 border-danger bg-[#fffbfa] px-3 py-2 text-[12px]">
                <div className="font-bold text-danger">Blocked: Unauthorized $12,000 Bank Wire</div>
                <div className="mt-0.5 text-[#374151]">
                  Tampered invoice text tried to send $12,000 to an unapproved bank account.
                </div>
              </li>
            );
          }
          if (e.type === 'LIVE_FAILED') {
            return (
              <li key={i} className="rounded-lg border-2 border-danger bg-[#fffbfa] px-3 py-2 text-[12px]">
                <div className="font-bold text-danger">Step 5 · Billing Rejected $2,000 Credit Note</div>
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
