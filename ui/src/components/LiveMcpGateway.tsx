import { useState } from 'react';
import type { ProxyEvent, StatePayload } from '../types';

type Preset = {
  id: string;
  label: string;
  badge: string;
  badgeClass: string;
  description: string;
  method: string;
  params: Record<string, unknown>;
  needsTx?: boolean;
};

const PRESETS: Preset[] = [
  {
    id: 'list_tools',
    label: '1. Discover MCP Tools (tools/list)',
    badge: 'READ-ONLY',
    badgeClass: 'bg-[#eef4ff] text-[#1d4ed8]',
    description: 'Standard MCP JSON-RPC 2.0 handshake — lists all enterprise tools protected by Ablate.',
    method: 'tools/list',
    params: {},
  },
  {
    id: 'read_order',
    label: '2. Read Live SQLite Order (PO-1042)',
    badge: 'REAL SQLITE',
    badgeClass: 'bg-[#ecfdf5] text-[#15803d]',
    description: 'Calls erp.get_po over real MCP JSON-RPC 2.0 directly against the live ERP SQLite database.',
    method: 'tools/call',
    params: { name: 'erp.get_po', arguments: { po_id: 'PO-1042' } },
  },
  {
    id: 'fraud_wire',
    label: '3. Attempt $12,000 Fraudulent Wire',
    badge: 'POLICY BLOCK',
    badgeClass: 'bg-[#fef2f2] text-[#b91c1c]',
    description: 'Sends a real MCP tools/call to wire $12,000 to an unapproved IBAN — watch Ablate block it in staging.',
    method: 'tools/call',
    needsTx: true,
    params: {
      name: 'billing.send_wire_payout',
      arguments: {
        invoice_id: 'INV-88',
        amount_usd: 12000,
        vendor_iban: 'DE99500105175407324931',
        reason: 'Urgent vendor settlement',
      },
    },
  },
];

export default function LiveMcpGateway(props: {
  apiBase: string;
  events: ProxyEvent[];
  state: StatePayload | null;
  onRefresh: () => void;
}) {
  const { apiBase, events, state, onRefresh } = props;
  const mcpUrl = `${apiBase}/mcp`;
  const [copied, setCopied] = useState<string | null>(null);
  const [clientTab, setClientTab] = useState<'claude' | 'cursor' | 'curl'>('claude');
  const [busy, setBusy] = useState<string | null>(null);
  const [lastReq, setLastReq] = useState<string | null>(null);
  const [lastRes, setLastRes] = useState<string | null>(null);
  const [lastLatency, setLastLatency] = useState<number | null>(null);

  const copyText = (key: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1800);
  };

  const claudeConfig = JSON.stringify(
    {
      mcpServers: {
        ablate: {
          command: 'python',
          args: ['-m', 'ablate_tx.mcp_stdio'],
          env: { ABLATE_URL: apiBase },
        },
      },
    },
    null,
    2,
  );

  const cursorConfig = JSON.stringify(
    {
      mcpServers: {
        ablate: {
          url: mcpUrl,
        },
      },
    },
    null,
    2,
  );

  const curlCmd = `curl -X POST ${mcpUrl} \\\n  -H "Content-Type: application/json" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`;

  const runPreset = async (preset: Preset) => {
    setBusy(preset.id);
    const t0 = performance.now();
    try {
      let sessionHeader: Record<string, string> = {};
      if (preset.needsTx) {
        const txRes = await fetch(`${apiBase}/tx/begin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const txData = (await txRes.json()) as { tx_id?: string };
        if (txData.tx_id) {
          sessionHeader = { 'Mcp-Session-Id': txData.tx_id };
        }
      }

      const payload = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: preset.method,
        params: preset.params,
      };
      setLastReq(JSON.stringify(payload, null, 2));

      const res = await fetch(mcpUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sessionHeader },
        body: JSON.stringify(payload),
      });
      const json = await res.json();

      // If this was a staged write transaction, commit it so the 5 deterministic rules evaluate live
      if (preset.needsTx && sessionHeader['Mcp-Session-Id']) {
        const commitRes = await fetch(`${apiBase}/tx/commit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tx_id: sessionHeader['Mcp-Session-Id'] }),
        });
        const commitJson = await commitRes.json();
        setLastRes(JSON.stringify({ staged_call_response: json, ablate_gate_verdict: commitJson }, null, 2));
      } else {
        setLastRes(JSON.stringify(json, null, 2));
      }

      setLastLatency(Math.round(performance.now() - t0));
      onRefresh();
    } catch (err) {
      setLastRes(JSON.stringify({ error: String(err) }, null, 2));
    } finally {
      setBusy(null);
    }
  };

  const recentEvents = [...events].reverse().slice(0, 8);
  const rawState = state as Record<string, unknown> | null;
  const erpOrders = (rawState?.erp as { purchase_orders?: Record<string, { qty?: number }> } | undefined)?.purchase_orders;
  const invMap = (rawState?.inventory as { stock?: Record<string, { reserved?: number }> } | undefined)?.stock;
  const poQty = erpOrders?.['PO-1042']?.qty ?? 500;
  const stockQty = invMap?.['SKU-900']?.reserved ?? 500;

  return (
    <div className="flex flex-col gap-5">
      {/* Top Banner */}
      <div className="rounded-xl border border-line bg-paper p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#1d4ed8]">
              Real Production MCP Server (JSON-RPC 2.0 · Zero Mock)
            </div>
            <h2 className="mt-0.5 text-[18px] font-bold text-ink">
              Connect Any Live AI Agent (Claude Desktop, Cursor, or Custom Agent)
            </h2>
            <p className="mt-1 text-[13px] text-muted">
              Every tool call sent to this endpoint hits real SQLite databases through Ablate’s Staging Sandbox, 5 Deterministic Rules, and Reverse-Saga engine—and streams live below.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#15803d]" />
            <code className="font-mono text-[12px] font-semibold text-ink">{mcpUrl}</code>
            <button
              onClick={() => copyText('url', mcpUrl)}
              className="ml-1 rounded bg-[#eef4ff] px-2.5 py-1 text-[11px] font-bold text-[#1d4ed8] hover:bg-[#dbeafe]"
            >
              {copied === 'url' ? 'Copied ✓' : 'Copy URL'}
            </button>
          </div>
        </div>
      </div>

      {/* Main 2-Column Layout */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Left: Live Browser MCP Tester */}
        <div className="flex flex-col gap-4 rounded-xl border border-line bg-white p-5">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#1d4ed8]">
              1-Click Live MCP Protocol Test
            </div>
            <h3 className="mt-0.5 text-[16px] font-bold text-ink">
              Fire Real JSON-RPC 2.0 Calls to <code className="font-mono text-[14px]">POST /mcp</code>
            </h3>
          </div>

          <div className="flex flex-col gap-2.5">
            {PRESETS.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-paper p-3.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-bold text-ink">{p.label}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${p.badgeClass}`}>
                      {p.badge}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12px] text-muted">{p.description}</p>
                </div>
                <button
                  onClick={() => void runPreset(p)}
                  disabled={!!busy}
                  className="shrink-0 rounded-lg bg-ink px-3.5 py-2 text-[12px] font-semibold text-white hover:bg-black disabled:opacity-50"
                >
                  {busy === p.id ? 'Sending…' : 'Send MCP Call →'}
                </button>
              </div>
            ))}
          </div>

          {/* Request / Response Inspector */}
          {lastRes && (
            <div className="mt-1 rounded-lg border border-line bg-[#111318] p-4 text-white">
              <div className="mb-2 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[#9ca3af]">
                <span>Live MCP JSON-RPC Response</span>
                {lastLatency !== null && <span className="text-[#4ade80]">{lastLatency} ms</span>}
              </div>
              {lastReq && (
                <details className="mb-2">
                  <summary className="cursor-pointer text-[11px] font-semibold text-[#93c5fd]">
                    View Sent JSON-RPC Request
                  </summary>
                  <pre className="mt-1.5 max-h-32 overflow-auto rounded bg-black/40 p-2 font-mono text-[11px] text-[#e5e7eb]">
                    {lastReq}
                  </pre>
                </details>
              )}
              <pre className="max-h-64 overflow-auto font-mono text-[11px] leading-relaxed text-[#e5e7eb]">
                {lastRes}
              </pre>
            </div>
          )}
        </div>

        {/* Right: Plug into Claude Desktop / Cursor + Live Database State */}
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-line bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#15803d]">
                  Zero-Cost External Client Setup
                </div>
                <h3 className="mt-0.5 text-[16px] font-bold text-ink">
                  Connect Claude Desktop, Cursor, or CLI
                </h3>
              </div>
              <div className="flex gap-1 rounded-lg bg-paper p-1">
                {(['claude', 'cursor', 'curl'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setClientTab(t)}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-bold uppercase transition ${
                      clientTab === t ? 'bg-ink text-white' : 'text-muted hover:text-ink'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative mt-3 rounded-lg bg-[#111318] p-3.5">
              <button
                onClick={() =>
                  copyText(
                    'cfg',
                    clientTab === 'claude' ? claudeConfig : clientTab === 'cursor' ? cursorConfig : curlCmd,
                  )
                }
                className="absolute right-2.5 top-2.5 rounded bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-white/20"
              >
                {copied === 'cfg' ? 'Copied ✓' : 'Copy'}
              </button>
              <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed text-[#e5e7eb]">
                {clientTab === 'claude' ? claudeConfig : clientTab === 'cursor' ? cursorConfig : curlCmd}
              </pre>
            </div>
          </div>

          {/* Live SQLite Database & Incoming MCP Event Stream */}
          <div className="rounded-xl border border-line bg-white p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-[14px] font-bold text-ink">Live SQLite Database State &amp; Incoming MCP Stream</h3>
              <span className="rounded-full bg-[#ecfdf5] px-2.5 py-0.5 text-[11px] font-bold text-[#15803d]">
                PO-1042: {poQty} boxes · Stock: {stockQty}
              </span>
            </div>
            <div className="mt-3 flex flex-col gap-1.5">
              {recentEvents.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line p-4 text-center text-[12px] text-muted">
                  Click any MCP Call button on the left—or send a prompt from Claude Desktop—to watch live MCP events stream here.
                </div>
              ) : (
                recentEvents.map((ev, idx) => {
                  const evData = ev as unknown as Record<string, unknown>;
                  const toolName = typeof evData.tool === 'string' ? evData.tool : null;
                  return (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-2 rounded-md border border-line bg-paper px-3 py-1.5 text-[12px]"
                    >
                      <span className="font-mono font-bold text-ink">{ev.type}</span>
                      <span className="truncate text-muted">
                        {toolName ? toolName : ev.tx_id ? `Session ${ev.tx_id.slice(0, 8)}` : 'System Event'}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
