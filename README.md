# 🤖 Autonomous SRE Log Investigation Agent

An autonomous, multi-step Site Reliability Engineering (SRE) agent designed to automate production incident diagnosis, log investigation, and ticket generation using **TypeScript**, **Vercel AI SDK**, and **Google Gemini**.

### 🚀 Key Engineering Highlights
* **SDK-Native ReAct Loop**: Leverages multi-step tool execution (`stopWhen: stepCountIs(...)`) to perform autonomous, iterative root-cause analysis without hardcoded workflows.
* **Type-Safe Tooling**: Fully typed tool definitions using `Zod` schemas for log querying, deployment history inspection, context recording, and ticket creation.
* **Context & Token Optimization**: Managed context window steps and fallback model strategies (`gemini-2.0-flash-lite`) to optimize for latency and strict API rate limits (15 RPM / 1,500 RPD).
* **Production-Grade Design**: Clean modular architecture separating agent runtime, tool definitions, log dataset fixtures, and types.

---

## 🏗️ How It Works (ReAct Workflow)

Rather than using rigid `if/else` logic, the agent operates in an autonomous loop:

1. **Observe & Plan**: Evaluates incoming logs from the target Log Set and determines what evidence is missing.
2. **Execute Tools**: Calls typed system tools to search related historical logs or inspect recent system deployments.
3. **Synthesize & Document**: Records investigation findings using structured notes.
4. **Take Action**: Automatically creates a prioritized Incident Ticket when a clear root cause is identified.
5. **Final Briefing**: Synthesizes all gathered evidence into a human-readable SRE Incident Report.

[ Incoming Incident Logs ]
│
▼
🤖 Gemini Agent (ReAct Loop)
├── 1. getRecentChanges() ───────► Inspect deployments
├── 2. searchLogsByIdentifier() ─► Trace request / batch IDs
├── 3. recordInvestigationNote() ► Log key findings
└── 4. createTicket() ───────────► Trigger incident creation
│
▼
[ Final SRE Incident Summary ]


---

## 🛠️ Built-in Tools

| Tool | Purpose | Schema Validation |
| :--- | :--- | :--- |
| `getRecentChanges` | Fetches recent code deployments or config changes | None (Returns recent changes) |
| `searchLogsByIdentifier` | Queries historical log sets by `user_id`, `request_id`, etc. | `{ identifier: z.string() }` |
| `recordInvestigationNote` | Saves key observations into the agent's scratchpad | `{ note: z.string() }` |
| `createTicket` | Creates a formal ticket (e.g., Jira/GitHub Issues) | `{ title, severity, description }` |

---

## 📺 Example Execution Output

```text
🚀 Starting investigation for Log Set #4...

🗒️ [Tool Action] Investigation Note: Deployment of 'New recommendations feature' at 17:29:52 introduced database connection pool exhaustion across services (recommendations-service, payment-service, auth-service) starting at 17:30:01.

📝 [Tool Action] Ticket Created: TICKET-5115 (HIGH)

🤖 Agent Final Answer:
### Incident Summary
Between 17:30:01 and 17:35:00 UTC, multiple microservices experienced widespread database connection timeouts.

### Root Cause
The deployment of the "New recommendations feature" at 17:29:52 triggered unoptimized connection pooling, saturating the PostgreSQL cluster.

### Action Taken
- Recorded investigation findings into the system audit log.
- Created incident ticket TICKET-5115 with HIGH severity.

Tool activity:
- getRecentChanges
- searchLogsByIdentifier
- recordInvestigationNote
- createTicket
⚙️ Environment Configuration
Create a .env file in the root directory based on the template below:

קטע קוד
# Google Gemini API Key (Get one at [https://aistudio.google.com/](https://aistudio.google.com/))
GOOGLE_GENERATIVE_AI_API_KEY="your-gemini-api-key-here"

# (Optional) Preferred Default Model
MODEL_NAME="gemini-flash-latest"
📦 Getting Started
Prerequisites
Node.js: v18.x or higher

Package Manager: pnpm, npm, or yarn

Installation
Clone the repository:

Bash
git clone [https://github.com/your-username/sre-log-investigation-agent.git](https://github.com/your-username/sre-log-investigation-agent.git)
cd sre-log-investigation-agent
Install dependencies:

Bash
npm install
Set up environment variables:

Bash
cp .env.example .env
(Make sure to add your actual GOOGLE_GENERATIVE_AI_API_KEY in .env)

Run the Agent:

Bash
npm start
# or for development mode:
npm run dev
🧪 Project Structure
Plaintext
├── src/
│   ├── index.ts               # Main ReAct loop & orchestration
│   ├── tools/                 # Tool definitions (Zod validated)
│   ├── datasets/              # Simulated log sets & incident fixtures
│   └── types/                 # Shared TypeScript interfaces
├── .env.example               # Environment variables template
├── package.json
└── tsconfig.json

---
.json`.
