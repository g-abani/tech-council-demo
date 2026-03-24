# Secure Agentic AI — POC (incremental)

KISS / DRY / YAGNI. This doc tracks **deck API names → LangChain JS 1.x** and implementation steps.

## Deck vs LangChain JS (this repo: `langchain` ^1.1.x)

| Deck slide | Concept | LangChain JS implementation |
|------------|---------|----------------------------|
| `createGuardrail({ type: "input" })` | Block / filter unsafe input | **`createMiddleware`** + `wrapModelCall` (and/or **`piiMiddleware`**) |
| `createGuardrail({ type: "output" })` | Output DLP | **`createMiddleware`** `afterModel` / `wrapModelCall` + **`piiMiddleware`** `applyToOutput` *(Step 3)* |
| RBAC | Least-privilege tools | **`createMiddleware`** `wrapModelCall` + filter `request.tools` *(Step 2)* |
| HITL | Approve destructive tools | **`humanInTheLoopMiddleware`** + interrupts *(Step 4)* |
| JIRA on-prem chat | Ollama for JIRA paths | **`ChatOllama`** / **`initChatModel("ollama:…")`** — JIRA sub-agent + supervisor when user text is JIRA-like (`jiraOllamaModel.ts`, `dynamicModelMiddleware.ts`) *(Step 5)* |

`createGuardrail` is **not** an export in `langchain@1.1.x`; the rows above are the supported equivalents.

## Environment

| Variable | Default | Meaning |
|----------|---------|---------|
| `SECURE_AGENT_INPUT_GUARD` | *(on if unset)* | Set to `false` to disable Step 1 middleware (injection block + PII redact on input). |
| `SECURE_AGENT_EMAIL_HASH_VAULT` | `false` | Set to `true` with input guard **on** to enable **email hash vault** + `piiMiddleware("email", { strategy: "hash" })` and the **`send_email_demo`** tool (in-memory hash→email map; use Redis/Vault in production). |
| `SECURE_AGENT_RBAC` | *(on if unset)* | Set to `false` to disable Step 2 RBAC tool filtering. |
| `SECURE_AGENT_OUTPUT_DLP` | *(on if unset)* | Set to `false` to disable Step 3 output PII redaction + audit file. |
| `SECURE_AGENT_HITL` | *(on if unset)* | Set to `false` to disable Step 4 `humanInTheLoopMiddleware` (destructive tool still exists but is not intercepted). |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama HTTP API ( **`JIRA` sub-agent only**; supervisor/workers use Azure). |
| `JIRA_OLLAMA_MODEL` | *(falls back to `OLLAMA_MODEL`)* | Model name for **`delegate_to_jira_agent`** (`src/poc/jiraOllamaModel.ts`). |
| `OLLAMA_MODEL` | `llama3.2` | Fallback if `JIRA_OLLAMA_MODEL` is unset. |
| `JIRA_OLLAMA_TEMPERATURE` | `0` | Optional temperature for JIRA `ChatOllama`. |
| `SECURE_AGENT_DYNAMIC_MODEL` | *(on if unset)* | Set to `false` to disable supervisor **dynamic routing** (`wrapModelCall` + `initChatModel`). When **on**: last user text **JIRA-like** → **Ollama**; else **Azure** — small vs large by `messages.length` vs threshold ([LangChain pattern](https://docs.langchain.com/oss/javascript/langchain/middleware/custom#dynamic-model-selection)). |
| `SECURE_AGENT_DYNAMIC_MODEL_MESSAGE_THRESHOLD` | `10` | Azure branch only: message-count cutoff (same default as the docs `gpt-4.1` / `mini` example). |
| `SECURE_AGENT_DYNAMIC_MODEL_DEBUG` | *(off)* | Set to `true` to log intent branch (ollama vs azure-large vs azure-small) per model call. |

## Steps checklist

- [x] **Step 0** — This doc + shared POC module layout (`src/poc/`)
- [x] **Step 1** — Input guard: prompt-injection block + `piiMiddleware` (email + SSN-style + credit card) on input; optional **email hash vault** (`SECURE_AGENT_EMAIL_HASH_VAULT=true`) stores raw addresses before hashing (same algorithm as LangChain: `sha256(email).slice(0,8)` → `<email_hash:…>`) for the **`send_email_demo`** tool
- [x] **Members DB demo** — PostgreSQL table `members` + tool **`lookup_member`** (`scripts/members.sql`, `DATABASE_URL` / `POSTGRES_URL`). With **`returnDirect`** tools, LangGraph may skip a final `beforeModel`, so `piiMiddleware` might not see tool text — **`redactPiiToolOutputText`** mirrors redact placeholders when **Step 3** output DLP is on. **RBAC role does not change PII visibility**; only output DLP + redaction apply.
- [x] **Step 2** — RBAC: `wrapModelCall` tool filter by `userRole` in runtime context (`src/poc/rbacMiddleware.ts`)

### Step 2 — Roles & tools (KISS)

| `userRole` | Tools allowed |
|------------|----------------|
| `viewer` | `azure_search_qna`, `lookup_member` (PostgreSQL demo) |
| `editor` | `azure_search_qna`, `lookup_member`, `delegate_to_jira_agent`, `delegate_to_calculator_agent`, `send_email_demo` |
| `admin` | all (includes `delegate_to_research_agent`, `delete_confidential_record`) |

Effective role is resolved server-side (**realtime RBAC**): **universal admin** allowlist (`SECURE_AGENT_UNIVERSAL_ADMIN_MEMBER_IDS`) → **Microsoft Graph** user lookup by `memberEmail` + **`checkMemberGroups`** against `MS_GRAPH_GROUP_OBJECT_ID_*` when `SECURE_AGENT_RBAC_SOURCE` is `graph` or `auto` → optional fallback. The **Demo user** picker sends `memberEmail` and `memberId` (same as `GET /api/members`).

Legacy: if `SECURE_AGENT_RBAC_SOURCE=header`, you can still pass **`userRole`** in the JSON body; otherwise omit it and use member + Graph fields. See **`SECURE-AGENT-POC-QUERY-BANK.md`** for queries ↔ code.

The **web UI** (`public/index.html`) uses a **Demo user** dropdown (`GET /api/members`), not a manual role dropdown.

**Entra / Graph:** configure **`MS_GRAPH_TENANT_ID`**, **`MS_GRAPH_CLIENT_ID`**, **`MS_GRAPH_CLIENT_SECRET`**, and group object IDs in **`.env.example`**. Implementation: `src/services/graph/`, `src/poc/graphRbacResolve.ts`.

**`/api/chat` only:** set **`freshThread`: `true`** (or **`newThread`**) to generate a new `threadId` and avoid reusing a broken checkpoint.

### Troubleshooting: `INVALID_TOOL_RESULTS` / “tool_calls must be followed by tool messages”

LangGraph **persists** each `threadId` in memory. If a prior run stopped after the model emitted **tool_calls** but before **tool results** were saved (interrupt, error, closed tab), the next request **appends** a new user message to **invalid** state → this error.

**Fix:** use a **new** `threadId`, or call `/api/chat` with **`"freshThread": true`**.

```bash
# Realtime RBAC: identify the user like the UI (member row from GET /api/members).
# Set SECURE_AGENT_RBAC_SOURCE=graph or auto in .env so role comes from Entra groups.
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Research Python 3.12 highlights","freshThread":true,"memberEmail":"behera@adobe.com","memberId":"behera"}'
```

Replace `memberEmail` / `memberId` with values from your `members` table. For **`SECURE_AGENT_RBAC_SOURCE=header`** only, you may pass `"userRole":"viewer"` instead of member fields.

- [x] **Step 3** — Output DLP: `piiMiddleware` uses **one** registration per type (email + SSN) shared with Step 1; `applyToOutput` / `applyToToolResults` turn on when `SECURE_AGENT_OUTPUT_DLP` is on. Audit: `logs/output-dlp-audit.jsonl` (`src/poc/outputDlp.ts`).

### Step 3 — Output DLP audit

After each model completion, one JSON line is appended to **`logs/output-dlp-audit.jsonl`** (and echoed to the server console as `[OUTPUT_DLP_AUDIT]`). Truncated to ~480 chars for the demo.

**Why not two `piiMiddleware("email")`?** LangChain’s agent throws `Middleware PIIMiddleware[email] is defined multiple times` — input + output PII are **one** middleware with `applyToInput` / `applyToOutput` / `applyToToolResults` set from env (`inputSafety.ts`).

PII patterns (email, `XXX-XX-XXXX` SSN) are redacted on **assistant** and **tool** messages when Step 3 is enabled.

- [x] **Step 4** — HITL: `humanInTheLoopMiddleware` intercepts **`delete_confidential_record`** (mock) before tools run; **`delegate_to_research_agent`** keeps the legacy **in-tool** `interrupt()` flow. Resume payloads differ: middleware uses **`HITLResponse`** (`{ decisions: [{ type: "approve" \| "reject" }] }`); research uses **`{ action, query? }`**. The UI (`public/index.html`) detects `actionRequests` + `reviewConfigs` vs legacy fields.

### Step 4 — Two interrupt styles (demo)

**Server note:** Pending HITL is derived from **`__interrupt__` on streamed graph chunks** (`src/poc/streamInterrupts.ts`). Do not rely on `getState().tasks[].interrupts` after resume — it can stay populated and cause a **duplicate** `interrupt` SSE + second approval card.

| Flow | Where it pauses | Client resume shape |
|------|------------------|---------------------|
| `delete_confidential_record` | `humanInTheLoopMiddleware` (`src/poc/hitlMiddleware.ts`) | `{ decisions: [{ type: "approve" }] }` or `{ decisions: [{ type: "reject", message: "..." }] }` |
| `delegate_to_research_agent` | `interrupt()` inside `worker-tools.ts` | `{ action: "approve", query? }` / `{ action: "reject" }` |

Disable Step 4 middleware with **`SECURE_AGENT_HITL=false`** (tool remains; approval is skipped when middleware is off).

- [x] **Step 5** — **Hybrid routing:** **`ChatOllama`** / **`initChatModel("ollama:…")`** for **JIRA** paths (`src/poc/jiraOllamaModel.ts`, `src/agents/jira/jira-agent.ts`, supervisor **`DynamicModelMiddleware`** when intent is JIRA-like). **Other supervisor turns and workers** use **Azure OpenAI** (`src/services/llm.ts`, `createChatModel()` → `createAzureModel()` in `src/config/model.ts`). Pull the Ollama model before use (`ollama pull …`).

**Troubleshooting:** `ERR_PACKAGE_PATH_NOT_EXPORTED` for `@langchain/core/utils/standard_schema` means **`@langchain/core` is too old** for `@langchain/ollama`. This repo pins **`@langchain/core` ≥ 1.1.35** (see `package.json`). Run `npm install` after pulling.

### Dynamic model selection (supervisor)

Implements [Dynamic model selection](https://docs.langchain.com/oss/javascript/langchain/middleware/custom#dynamic-model-selection) with **`createMiddleware` + `wrapModelCall`** + **`initChatModel`** in `src/poc/dynamicModelMiddleware.ts`: **JIRA intent** → Ollama; else **Azure** large vs small by message count (aligned with `gpt-4.1` / `mini`-style switching). **On by default**; set **`SECURE_AGENT_DYNAMIC_MODEL=false`** to use the static supervisor model (`llm` only, no routing middleware).

If **Ollama is not running**: the supervisor **retries that turn on Azure** (logs a warning). **`delegate_to_jira_agent`** also retries the JIRA sub-agent on **Azure** (`src/agents/supervisor/worker-tools.ts`) so delegation does not throw `fetch failed`.

## Draft user queries (manual testing)

See **[`SECURE-AGENT-POC-QUERY-BANK.md`](./SECURE-AGENT-POC-QUERY-BANK.md)** for example user messages per step and sub-step (RBAC, HITL, JIRA, DLP, etc.).

## MCP note

MCP servers for LangChain **documentation** are useful while coding; they are **not** a runtime security control for this POC.
