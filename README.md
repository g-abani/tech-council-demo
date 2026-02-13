# LangGraph Multi-Agent Demo (JS)

A plain HTML/JS multi-agent chat app showcasing LangChain + LangGraph capabilities with an Express server.

## Features

- Multi-agent routing (supervisor → JIRA agent / research agent / calculator agent / Azure Search RAG)
- Tool calling and tool selection
- Streaming responses (Server-Sent Events)
- Human-in-the-loop approvals (interrupt + resume via durable execution)
- Retrieval-augmented generation (RAG) over an Azure AI Search knowledge base
- Thread-level memory via LangGraph checkpointer
- Context engineering with middleware (summarization, context editing)

## Prerequisites

- Node.js 18+
- An Azure OpenAI resource with a deployed model (e.g. `gpt-4o`)
- (Optional) Azure AI Search index for RAG
- (Optional) JIRA access via iPaaS / IMS credentials
- (Optional) LangSmith account for tracing

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy the example environment file and fill in your credentials:

```bash
cp .env.example .env
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `AZURE_OPENAI_API_KEY` | Yes | Azure OpenAI API key |
| `AZURE_OPENAI_API_INSTANCE_NAME` | Yes | Azure OpenAI instance name |
| `AZURE_OPENAI_API_DEPLOYMENT_NAME` | Yes | Model deployment name (e.g. `gpt-4o`) |
| `AZURE_OPENAI_API_VERSION` | Yes | API version (e.g. `2025-01-01-preview`) |
| `AZURE_SEARCH_ENDPOINT` | No | Azure AI Search endpoint (for RAG tool) |
| `AZURE_SEARCH_API_KEY` | No | Azure AI Search API key |
| `AZURE_SEARCH_INDEX` | No | Azure AI Search index name |
| `LANGSMITH_TRACING` | No | Enable LangSmith tracing (`true`/`false`) |
| `LANGSMITH_API_KEY` | No | LangSmith API key |
| `JIRA_IMS_CLIENT_ID` | No | IMS client ID for JIRA access |
| `JIRA_IMS_CLIENT_SECRET` | No | IMS client secret |
| `JIRA_IMS_CLIENT_CODE` | No | IMS authorization code |
| `JIRA_USERNAME` | No | JIRA username |
| `JIRA_PASSWORD` | No | JIRA password |
| `IPAAS_JIRA_API_KEY` | No | iPaaS API key for JIRA proxy |
| `PORT` | No | Server port (default: `3000`) |

> Only Azure OpenAI variables are required to start the server. JIRA and Azure Search features degrade gracefully when their credentials are not configured.

3. Build and run:

```bash
npm run build
npm start
```

Or for development (build + run):

```bash
npm run dev
```

Open `http://localhost:3000` in the browser.

## Project Structure

```
src/
├── server.ts                          # Express server with SSE streaming endpoints
├── config/
│   └── model.ts                       # Azure OpenAI model factory & env validation
├── agents/
│   ├── workers.ts                     # Research & Calculator worker agents
│   ├── supervisor/
│   │   ├── supervisor.ts              # Supervisor agent (orchestrates workers)
│   │   ├── supervisor-runner.ts       # Stream/resume/interrupt helpers
│   │   ├── worker-tools.ts            # Worker agents wrapped as supervisor tools
│   │   ├── tools.ts                   # Research, calculator, text-analysis tools
│   │   └── supervisor-tools/
│   │       ├── azure-search.ts        # Azure AI Search RAG tool
│   │       └── searchClient.ts        # Azure Search client (lazy-initialized)
│   └── jira/
│       ├── jira-agent.ts              # JIRA specialist agent
│       └── tools/                     # JIRA tool implementations
├── services/
│   ├── llm.ts                         # Shared LLM instances
│   └── external/
│       ├── jiraService.ts             # JIRA API service layer
│       └── imsTokenProvider.ts        # IMS token management
└── utils/
    └── statistics.ts                  # Token counting utilities
```

## Notes

- Thread ID controls memory. Use the "New Thread" button to reset memory.
- The approval flow uses LangGraph interrupts; approve or reject in the UI to resume.
- Azure Search and JIRA features are optional — the app starts without them and fails gracefully at tool-call time if credentials are missing.
