import type { ProxyEvent, TxReceipt } from '../types';
import { StepCallout, friendlyArgs, friendlyToolName } from './ui';

// Left pane: 6-stage step-by-step reveal of the AI Assistant's actions with inline Step 1 & Step 2 dialogue boxes.

const SHOWN = new Set(['TOOL_CALL', 'TAINT_VIOLATION', 'LIVE_FAILED']);

function toolKind(rawTool: string): { isRead: boolean; isCommit: boolean } {
  return { isRead: /(^|[._])get_/.test(rawTool), isCommit: rawTool.includes('commit') };
}

export default function AgentPane({
  events,
  receipt,
  stage = 6,
  onSetStage,
}: {
  events: ProxyEvent[];
  receipt?: TxReceipt | null;
  stage?: number;
  onSetStage?: (s: number) => void;
}) {
  const allRows = events.filter((e) => SHOWN.has(e.type));
  const seenTools = new Set<string>();
  const rows = allRows.filter((e) => {
    if (e.type === 'TOOL_CALL') {
      const rawTool = e.message.split(' called ')[1] ?? e.message;
      if (rawTool.includes('issue_credit_note') && seenTools.has('credit')) return false;
      if (rawTool.includes('issue_credit_note')) seenTools.add('credit');
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

  const isFraudScenario = receipt?.status === 'ABORTED_IN_SHADOW';

  return (
    <section
      className={`flex min-h-0 flex-col rounded-xl border bg-white transition-all ${
        stage === 1 || stage === 2 ? 'border-2 border-[#1d4ed8] shadow-md' : 'border-line'
      }`}
    >
      <header className="border-b border-line px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-bold">AI Operations Assistant</h2>
          <span className="rounded bg-[#eef4ff] px-2 py-0.5 text-[11px] font-semibold text-[#1d4ed8]">
            Google Gemini
          </span>
        </div>
        <div className="text-[12px] text-muted">Actions requested by the AI to fix the 20-box shortage</div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
        {visibleRows.length === 0 && (
          <div className="rounded-lg border border-dashed border-line p-6 text-center text-[13px] text-muted">
            Load a scenario above to start at Step 1 and see each action explained.
          </div>
        )}

        <ol className="space-y-2">
          {visibleRows.map((e, i) => {
            const d = (e.data ?? {}) as Record<string, unknown>;
            if (e.type === 'TOOL_CALL') {
              const rawTool = e.message.split(' called ')[1] ?? e.message;
              const args = (d.args ?? {}) as Record<string, unknown>;
              const { isRead, isCommit } = toolKind(rawTool);
              const highlight = (stage === 1 && isRead) || (stage === 2 && !isRead && !isCommit);
              return (
                <li
                  key={i}
                  className={`rounded-lg border px-3 py-2 transition-all duration-300 ${
                    highlight
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
                      {isCommit ? 'Step 3 · Commit' : isRead ? 'Step 1 · Read' : 'Step 2 · Update'}
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

        {/* Dialogue Box for Step 1 */}
        {stage === 1 && visibleRows.length > 0 && (
          <StepCallout
            step={1}
            title="AI Reads Current Records"
            text="The AI Assistant checks all three company databases first. It sees Order #1042 has 500 boxes ordered, 500 boxes reserved in the Warehouse, and an open $50,000 Billing invoice."
            tone="blue"
            onNext={onSetStage ? () => onSetStage(2) : undefined}
          />
        )}

        {/* Dialogue Box for Step 2 */}
        {stage === 2 && visibleRows.length > 0 && (
          <StepCallout
            step={2}
            title="AI Proposes Multi-System Updates"
            text={
              isFraudScenario
                ? 'Tricked by a fake remittance note inside the supplier invoice, the AI requests an unauthorized $12,000 bank wire to an unapproved IBAN account.'
                : 'Because only 480 boxes arrived (20 boxes short), the AI requests reducing Order #1042 to 480 boxes, releasing 20 Warehouse boxes, and issuing a $2,000 refund credit.'
            }
            tone={isFraudScenario ? 'amber' : 'blue'}
            onPrev={onSetStage ? () => onSetStage(1) : undefined}
            onNext={onSetStage ? () => onSetStage(3) : undefined}
          />
        )}
      </div>
    </section>
  );
}
