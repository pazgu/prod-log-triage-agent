# 🤖 Autonomous SRE Log Investigation Agent

An autonomous SRE agent that automates production incident triage, root-cause log analysis, and ticketing using **TypeScript**, **Vercel AI SDK**, and **Google Gemini**.

---

## 🚀 Key Highlights

* **Autonomous ReAct Loop**: Multi-step tool execution (`stopWhen: stepCountIs(...)`) for iterative root-cause analysis without hardcoded workflows.
* **Type-Safe Tooling**: `Zod` schemas enforce strict contracts for log queries, deployment history, context notes, and ticket creation.
* **State Synthesis**: Preserves context across execution frames using `response.steps` mapping.
* **Rate-Limit Resilience**: Optimized step bounds and model fallback strategy (`gemini-2.0-flash-lite`) to manage quota limits (15 RPM).

---

## 🏗️ ReAct Workflow

[ Incoming Incident Logs ]
│
▼
🤖 Gemini Agent
├── 1. getRecentChanges() ───────► Inspect code/config deployments
├── 2. searchLogsByIdentifier() ─► Trace request/user IDs across services
├── 3. recordInvestigationNote() ► Persist diagnostic findings
└── 4. createTicket() ───────────► Trigger automated incident ticket
│
▼
[ Final SRE Briefing & Root Cause Report ]


---

## 🛠️ Built-in Tools

| Tool | Description | Input Schema (`Zod`) |
| :--- | :--- | :--- |
| `getRecentChanges` | Inspects recent code deployments and infrastructure config changes | `z.object({})` |
| `searchLogsByIdentifier` | Queries historical log streams by `user_id`, `request_id`, or `batch_id` | `{ identifier: z.string() }` |
| `recordInvestigationNote` | Persists intermediate notes into runtime context | `{ note: z.string() }` |
| `createTicket` | Generates prioritized Jira/GitHub incident tickets | `{ title, severity, description }` |

---

## 📄 Real Execution Output

```text
🚀 Starting investigation for Log Set #4...

🗒️ [Tool Action] Note: Deployment of 'New recommendations feature' at 17:29:52 introduced DB connection pool exhaustion across microservices starting at 17:30:01.
📝 [Tool Action] Ticket Created: TICKET-5115 (Severity: HIGH)

🤖 Agent Final Answer:
### Incident Summary
Microservices experienced cascading database connection timeouts between 17:30:01 - 17:35:00 UTC.

### Root Cause
Unoptimized connection pooling in 'New recommendations feature' (deployed 17:29:52) saturated the PostgreSQL cluster.

### Action Taken
- Recorded evidence in system audit logs.
- Created ticket TICKET-5115 (Severity: HIGH).
🔑 Environment Setup (.env)

GOOGLE_GENERATIVE_AI_API_KEY="your-gemini-api-key"
MODEL_NAME="gemini-flash-latest"
