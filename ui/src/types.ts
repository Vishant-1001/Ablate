export type TxStatus =
  | 'COMMITTED'
  | 'ROLLED_BACK_CLEANLY'
  | 'ABORTED_IN_SHADOW'
  | 'ESCALATED_HITL'
  | 'QUARANTINED_CONCURRENT_EDIT'
  | 'PARTIAL_CORRUPTION';

export interface InvariantMap {
  ledger_balance: boolean;
  inventory_non_negative: boolean;
  dollar_cap: boolean;
  iban_integrity: boolean;
  taint_check: boolean;
  [key: string]: boolean;
}

export interface CompensationStep {
  tool?: string;
  for_tool?: string;
  action?: string;
  strategy?: string;
  status?: string;
  inverse_delta?: number;
  sku?: string;
  po_id?: string;
  detail?: string;
  [key: string]: unknown;
}

export interface TxReceipt {
  tx_id: string;
  status: TxStatus;
  invariants: InvariantMap;
  pre_tx_hashes: {
    erp: string;
    wms: string;
    billing: string;
    [key: string]: string;
  };
  post_tx_hashes: {
    erp: string;
    wms: string;
    billing: string;
    [key: string]: string;
  };
  hashes_match: boolean;
  rollback_ms: number | null;
  compensations: CompensationStep[];
  commit_order?: string[];
  staged_deltas?: Array<Record<string, unknown>>;
  receipt_hash: string;
  prev_hash: string;
  ts?: string;
  agent?: { mode?: string; model?: string; recorded_at?: string } | null;
  aegis_enabled?: boolean;
  commit_ms?: number;
  invariant_checks?: InvariantCheck[];
  steps?: SagaStep[];
  failure?: Record<string, unknown> | null;
  quarantine?: Array<{ entity: string; three_way_diff: Record<string, { base: unknown; ours: unknown; theirs: unknown }> }>;
}

export interface InvariantCheck {
  name: string;
  layer: number;
  result: 'PASS' | 'FAIL' | 'ESCALATE_HITL' | 'SKIPPED' | string;
  detail: Record<string, unknown>;
}

export interface SagaStep {
  step?: number;
  tool: string;
  status: string;
  result?: Record<string, unknown>;
  error?: { status: number; message: string };
  args?: Record<string, unknown>;
}

export interface PurchaseOrder {
  po_id: string;
  vendor?: string;
  amount_usd?: number;
  amount?: number;
  status: string;
  iban?: string;
  etag?: string;
  [key: string]: unknown;
}

export interface GLEntry {
  entry_id?: string;
  id?: string;
  account: string;
  debit: number;
  credit: number;
  memo?: string;
  [key: string]: unknown;
}

export interface InventoryItem {
  sku: string;
  name?: string;
  on_hand: number;
  reserved?: number;
  available?: number;
  etag?: string;
  [key: string]: unknown;
}

export interface InvoiceItem {
  invoice_id?: string;
  id?: string;
  po_id?: string;
  amount_usd?: number;
  amount?: number;
  status: string;
  iban?: string;
  [key: string]: unknown;
}

export interface CreditNoteItem {
  note_id?: string;
  id?: string;
  invoice_id?: string;
  amount_usd?: number;
  reason?: string;
  [key: string]: unknown;
}

export interface RuntimeConfig {
  aegis_enabled: boolean;
  fail_billing_409: boolean;
  simulate_human_edit: boolean;
  max_auto_usd: number;
}

export interface StatePayload {
  erp: {
    purchase_orders: PurchaseOrder[];
    gl_entries: GLEntry[];
    hash: string;
  };
  wms: {
    inventory: InventoryItem[];
    hash: string;
  };
  billing: {
    invoices: InvoiceItem[];
    credit_notes: CreditNoteItem[];
    hash: string;
  };
  config: RuntimeConfig;
}

export interface ProxyEvent {
  ts: string;
  tx_id: string;
  phase: string;
  type: string;
  message: string;
  data: Record<string, unknown>;
}

export type DemoAct =
  | 'act1_corruption'
  | 'act2_rollback'
  | 'act3_injection'
  | 'act4_etag_conflict';
