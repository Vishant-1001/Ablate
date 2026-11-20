# Ablate — 3-Minute Buildathon Demo Script & FDE Q&A Playbook

**Event:** Google Startup Buildathon India 2026  
**Product:** **Ablate** — *Transactional Runtime & Auto-Rollback Proxy for MCP Agents*  
**Format:** 3-Minute Live Split-Screen Demo + 5 Hard Google FDE Questions

---

## Pre-Demo Checklist (30 Seconds Before Stage)

1. Ensure backend is running on `http://localhost:8000` (`python run_all.py`).
2. Open **Ablate Split-Screen Mission Control** (`cd ui && npm run dev`).
3. Click **`Reset All 3 DBs`** in the top-right bar to confirm clean baseline SHA-256 hashes across **ERP**, **WMS**, and **Billing**.

---

## Word-for-Word 3-Minute Live Demo Script

### [0:00 – 0:30] The Hook & Why Round 1 → Round 2 Evolved
> "Everyone here is building agents with **Google ADK and Gemini** that talk to enterprise tools over **MCP**.  
> In Round 1, people asked: *'What happens when an autonomous agent spans three real enterprise systems—ERP, Warehouse Management, and Billing—and step 3 fails mid-flight, or a supplier email injects a poisoned IBAN?'*  
> Unlike SQL databases, third-party SaaS APIs don't give you `BEGIN` and `ROLLBACK`. When step 3 fails, steps 1 and 2 stay permanently mutated in production.  
> Between Round 1 and Round 2, we evolved **Ablate** from a static policy filter into a full **Transactional MCP Staging Proxy, 3-Layer Deterministic Invariant Gate, Optimistic ETag Concurrency Guard, and sub-400ms Reverse-Saga Rollback Engine**."

---

### [0:30 – 1:15] Act 1: The Disaster Today — Unprotected Partial Corruption
*(Action: Click **`Act 1: Unprotected Corruption`** in the Top Control Bar. Watch `Ablate Proxy [OFF]` and `Inject Billing 409 [ON]` light up.)*

> "Look at our 3-column Mission Control: on the left is our **Autonomous ADK + Gemini Agent** processing a procurement fulfillment workflow. In the center is **Ablate**. On the right are **3 live production databases**: ERP, WMS, and Billing, each stamped with a live SHA-256 state hash.  
> In **Act 1**, Ablate is **OFF**. The agent updates the ERP Purchase Order and posts a General Ledger entry—live ERP hash changes immediately. Next, it deducts 50 units from WMS inventory—live WMS hash changes.  
> Now it calls Billing to issue the invoice—and hits an **HTTP 409 Conflict**.  
> Look at the red banner on the right: **`PARTIAL CORRUPTION DETECTED ACROSS LIVE DATABASES`**. ERP and WMS were permanently mutated while Billing failed. In enterprise finance and supply chain, this silent cross-system drift is why CIOs refuse to move agents from read-only copilots to autonomous write production."

---

### [1:15 – 2:05] Act 2: Atomic Reverse-Saga Rollback in <400ms
*(Action: Click **`Act 2: Atomic Rollback (<400ms)`**. Ablate resets the DBs, switches `Ablate Proxy [ON]`, and keeps `Inject Billing 409 [ON]`.)*

> "Now let's run the exact same failure with **Ablate ON**.  
> First, notice the center pane: when the agent calls MCP tools, **zero writes hit live production**. Ablate intercepts every call into an ephemeral **Shadow Twin** with read-your-own-writes isolation.  
> Second, before promotion, Ablate runs our **3-Layer Deterministic Invariant Gate**—verifying double-entry GL balance (`ledger_balance`), non-negative stock (`inventory_non_negative`), `$25k` auto-approval caps (`dollar_cap`), IBAN registry integrity, and provenance taint.  
> Third, Ablate enforces the **Pivot Rule**: any irreversible external tool is scheduled strictly last.  
> Now watch what happens when Billing throws that same `409 Conflict` during commit: Ablate immediately fires an automatic **Reverse-Saga Rollback** in LIFO order—restoring WMS inventory via commutative deltas and reversing the ERP GL and PO state.  
> Look at the green banner on the right: **`PRE-TX HASH == POST-ROLLBACK HASH (100% ATOMIC CONSISTENCY RESTORED)`**, completed in under **400 milliseconds**, backed by a SHA-256 hash-chained `TxReceipt`."

---

### [2:05 – 2:40] Act 3: Indirect Prompt Injection Blocked in Shadow
*(Action: Click **`Act 3: Prompt Injection Blocked`**.)*

> "What if the API doesn't fail, but a malicious vendor embeds a prompt injection inside an invoice memo to swap the payout IBAN to an attacker account or drain inventory?  
> Watch **Act 3**: the agent parses untrusted external text and attempts to stage a wire payout to an injected IBAN.  
> Ablate tracks field-level provenance taint (`tainted_fields`) and checks our deterministic `iban_integrity` and `taint_check` invariants inside the Shadow Twin.  
> The transaction is killed **before a single byte leaves the proxy**—status: **`ABORTED_IN_SHADOW`**, **0 live writes**, and `PRE-TX HASH == POST-TX HASH`."

---

### [2:40 – 3:00] Act 4: Concurrent Human Edit Guard (ETag Conflict) & Close
*(Action: Click **`Act 4: ETag Conflict Guard`**.)*

> "Finally, what if a human warehouse manager or procurement officer edits a record while the agent's transaction is mid-flight? In **Act 4**, a human modifies the live record concurrently. Instead of blindly overwriting the human's work during rollback, Ablate's **Optimistic ETag Guard** detects the version mismatch, preserves the human edit intact, and transitions the transaction to **`QUARANTINED_CONCURRENT_EDIT`**.  
> Across our automated 15-episode pytest benchmark suite, Ablate takes cross-system consistency under faults and attacks from **0% to 100%**.  
> We are **Ablate**: making autonomous enterprise agents transactionally safe for production."

---

## Crisp Answers to the 5 Hardest Google FDE Questions

### Q1: "Enterprise ERPs like SAP or NetSuite have hidden internal triggers and side effects you can't see from an MCP response. How can your Shadow Twin or Rollback possibly guarantee consistency?"
**Answer:**
> "We don't pretend to emulate closed-source SAP SQL triggers inside our proxy—that would be brittle and dishonest. Instead, Ablate operates at the **canonical API resource contract level**:
> 1. **Shadow Twin Staging** models the **declared domain invariants** over the MCP resource schema (double-entry debit/credit conservation, SKU reservation math, PO state transitions, and dollar thresholds) so invalid multi-tool plans are caught before live API execution.
> 2. **Domain-Specific Compensating Actions**: In enterprise ERPs, you never 'delete' a posted journal entry or bypass internal triggers—you call the official compensating API (`erp.reverse_gl_entry`, `billing.issue_credit_note`, `wms.adjust_inventory`). That way, the ERP's own internal triggers fire symmetrically in reverse.
> 3. **Post-Rollback State Hashing**: After compensation, Ablate re-queries the live API state and computes a canonical domain hash (`post_tx_hashes`) excluding audit-trail reversal IDs, giving you deterministic verification that the net business state (balances, quantities, open statuses) returned to pre-transaction parity."

---

### Q2: "What happens when an agent calls a genuinely irreversible tool—like sending a SWIFT wire, firing an external email, or triggering a physical robot?"
**Answer:**
> "That is why we built the **Pivot Rule** into Ablate's transaction scheduler—inspired by Hector Garcia-Molina's classic Sagas paper and Google's own distributed transaction patterns:
> 1. Every MCP tool in the registry carries a reversibility classification: `REVERSIBLE` (has a registered compensation handler) or `PIVOT` (irreversible external side effect, like `billing.send_wire_payout`).
> 2. **Hard Admission Rule**: Ablate rejects any transaction containing **more than one `PIVOT` tool** upfront (`PIVOT_LIMIT_EXCEEDED`). If an agent wants two irreversible actions, it must split them into two separate transactions or escalate to HITL.
> 3. **Topological Commit Ordering**: During `POST /tx/commit`, Ablate reorders the execution plan so all `REVERSIBLE` mutations and all 3 layers of invariant gates execute **first**. The single `PIVOT` action executes **strictly last**—only after every reversible system has succeeded and locked in. If any earlier step fails, the `PIVOT` action never fires."

---

### Q3: "What if a human operator edits the same ERP Purchase Order or WMS SKU inventory in the middle of an agent's transaction? Won't your rollback overwrite the human's work?"
**Answer:**
> "Naive snapshot restore clobbers concurrent human edits; Ablate solves this with two distinct concurrency primitives tested in `test_etag_conflict_guard.py`:
> 1. **Commutative Delta Compensation for Numeric Counters (WMS)**: When an agent reserves `-50` units of a SKU and a human concurrently adds `+20` units, our compensation does **not** reset `on_hand` to the old snapshot value. It applies the commutative inverse delta (`+50`), preserving the human's `+20` adjustment intact.
> 2. **Optimistic Concurrency Control via Cryptographic ETags for State Records (ERP)**: Every staged record captures its pre-mutation `etag` / version hash. Before any Reverse-Saga compensation mutates a non-commutative record like a Purchase Order, Ablate compares the current live `etag` against the expected post-commit `etag`. If a human modified the record mid-flight, Ablate **refuses to clobber the human's edit**, halts automated compensation on that record, and emits `QUARANTINED_CONCURRENT_EDIT` with the exact diff for human resolution."

---

### Q4: "Why wouldn't an enterprise just use LangSmith, Composio, or Temporal instead of Ablate?"
**Answer:**
> "They solve completely different layers of the stack, and none of them provide an agent-transparent transactional staging proxy:
> - **LangSmith / Arize** are **post-hoc observability**. They give you a trace showing *how* your agent corrupted ERP and WMS 30 seconds ago, after the bad writes are already in production. Ablate prevents the corruption synchronously in the data path.
> - **Composio / standard MCP Gateways** handle **OAuth plumbing and tool routing**. They forward every tool call immediately to live APIs with zero transaction boundaries, zero read-your-own-writes shadow staging, and zero rollback orchestration.
> - **Temporal / Workflow Engines** require developers to **hardcode imperative deterministic DAGs** and manually author saga compensation branches for every static workflow in TypeScript/Go. Autonomous ADK + Gemini agents generate **dynamic, non-deterministic tool sequences at runtime**. Ablate infers the Reverse-Saga dynamically from the agent's ad-hoc MCP tool trajectory without forcing you to turn your agent back into a rigid state machine."

---

### Q5: "How does Ablate make money, and why won't model providers or MCP frameworks just build this in for free?"
**Answer:**
> "Model providers build reasoning engines, and MCP is intentionally a stateless transport protocol (like HTTP for tools). Neither wants to own **stateful enterprise ERP/WMS domain invariants, compensation catalogs, and SOX-compliant cryptographic audit ledgers**.  
> Our monetization has three tiers:
> 1. **Per-Transaction Metered Proxy (`$0.02–$0.05` / committed multi-system tx)**: Aligns price directly with autonomous back-office value (an agent processing 100,000 procurement or order-to-cash transactions a month generates `$2k–$5k/mo` while saving `$50k+` in manual reconciliation and error remediation).
> 2. **Enterprise Governance & Compliance Plane (`$48k+/yr`)**: Hash-chained `TxReceipt` ledger archival for SOX/SOC2 auditors, SIEM export, custom domain invariant packs (SAP, NetSuite, Salesforce, Stripe), and the `QUARANTINED_CONCURRENT_EDIT` / `ESCALATED_HITL` operations console.
> 3. **Expansion Wedge**: Teams drop Ablate in front of existing MCP servers in 5 minutes with zero prompt changes—giving them the safety certification needed to unlock autonomous write permissions across the enterprise."
