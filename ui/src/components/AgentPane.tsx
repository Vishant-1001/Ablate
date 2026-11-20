import type { ProxyEvent } from '../types';

// Left pane: what the ADK + Gemini agent is doing, as it happens (via SSE).

const SHOWN = new Set(['MCP_CONNECTED', 'MCP_UNAVAILABLE', 'AGENT_MODE', 'TOOL_CALL', 'AGENT_ERROR', 'AGENT_DONE', 'LIVE_WRITE', 'LIVE_FAILED', 'TAINT_VIOLATION', 'SHADOW_REJECTED', 'ACT_START']);

function argLine(data: Record<string, unknown>): string {
  const args = (data.args ?? {}) as Record<string, unknown>;
  return Object.entries(args)
    .filter(([k]) => k !== 'idempotency_key')
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(', ');
}

export default function AgentPane({ events }: { events: ProxyEvent[] }) {
  const rows = events.filter((e) => SHOWN.has(e.type));
  const mode = [...events].reverse().find((e) => e.type === 'AGENT_MODE');
  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-line bg-white">
      <header className="border-b border-line px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-bold">Agent</h2>
          <span className="font-mono text-[11px] text-muted">ADK · MCP JSON-RPC</span>
        </div>
        <div className="mt-0.5 truncate text-[12px] text-muted">
          {mode ? String((mode.data as Record<string, unknown>).model ?? (mode.data as Record<string, unknown>).mode ?? '') : 'idle'}
        </div>
      </header>
      <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {rows.length === 0 && <li className="p-3 text-[13px] text-muted">Run an act to watch the agent's tool calls stream in.</li>}
        {rows.map((e, i) => {
          const d = (e.data ?? {}) as Record<string, unknown>;
          if (e.type === 'TOOL_CALL') {
            const [who, tool] = e.message.split(' called ');
            return (
              <li key={i} className="rounded-lg border border-line bg-paper px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[12px] font-semibold text-ink">→ {tool}</span>
                  <span className="text-[10px] text-muted">{who}</span>
                </div>
                <div className="mt-0.5 break-words font-mono text-[11px] text-muted">{argLine(d)}</div>
              </li>
            );
          }
          if (e.type === 'TAINT_VIOLATION') {
            return (
              <li key={i} className="rounded-lg border border-[#f0d3cf] bg-[#fffbfa] px-3 py-2 text-[12px]">
                <div className="font-semibold text-danger">← TAINT_VIOLATION (feedback to agent)</div>
                <div className="mt-0.5 text-[#374151]">{String(d.feedback ?? '')}</div>
              </li>
            );
          }
          const tone =
            e.type === 'LIVE_FAILED' || e.type === 'AGENT_ERROR' || e.type === 'SHADOW_REJECTED'
              ? 'text-danger'
              : e.type === 'LIVE_WRITE'
                ? 'text-[#9a3412]'
                : 'text-[#374151]';
          return (
            <li key={i} className={`px-1 text-[12px] ${tone}`}>
              <span className="font-mono text-[11px] text-muted">{e.ts.slice(11, 19)}</span> {e.message}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
