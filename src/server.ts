/**
 * Express Server with Streaming Support
 * Demonstrates streaming for better user experience
 */

import express, { Request, Response } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { validateEnvironment } from "./config/model.js";
import  supervisor  from "./agents/supervisor/supervisor.js";
import jiraAgent from "./agents/jira/jira-agent.js";
import { countTokensApproximately, countMessagesTokens, type ConversationStatistics } from "./utils/statistics.js";
import { supervisorAgent, supervisorResume, getInterruptState } from "./agents/supervisor/supervisor-runner.js";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// In-memory statistics storage per thread
const threadStatistics = new Map<string, ConversationStatistics>();

function getThreadStats(threadId: string): ConversationStatistics {
  if (!threadStatistics.has(threadId)) {
    threadStatistics.set(threadId, {
      toolCalls: {},
      modelCalls: 0,
      tokens: { input: 0, output: 0, total: 0 },
      contextWindowSize: 0,
    });
  }
  return threadStatistics.get(threadId)!;
}

// Validate environment on startup
if (!validateEnvironment()) {
  console.error("❌ Environment validation failed. Please check your .env file.");
  process.exit(1);
}

console.log("✅ Environment validated successfully");

// Initialize supervisor agent once at startup (reuse across requests)

console.log("✅ Supervisor agent initialized");

/**
 * Health check endpoint
 */
app.get("/api/health", (req: Request, res: Response) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: {
      azureConfigured: !!process.env.AZURE_OPENAI_API_KEY,
    },
  });
});

app.post("/api/chat/stream2", async (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  
  const { message, threadId = "default" } = req.body;
  console.log(`[Supervisor] User message: ${message}`);
  
  if (!message) {
    res.status(400).json({ error: "Message is required" });
    return;
  }
  
  try {
    const startTime = Date.now();
    
    // Track statistics (based on langchat pattern)
    const toolsUsed: Record<string, number> = {};
    let fullResponse = "";
    let currentContextWindowSize = 0;  // Track context window from full messages
    console.time("supervisor_stream");
    const stream = await supervisorAgent({ message, threadId });
    console.timeEnd("supervisor_stream");
    console.time("supervisor_stream_loop");
    for await (const chunk of stream) {
      const state = chunk as any;
      
      // Calculate context window from FULL messages array (not just current request)
      if (state.messages && Array.isArray(state.messages)) {
        currentContextWindowSize = countMessagesTokens(state.messages);
      }
      
      const latestMessage = state.messages?.[state.messages.length - 1];
      
      if (latestMessage) {
        // Get message type
        const msgType = latestMessage._getType?.() || latestMessage.type || "unknown";
        
        // Skip human messages
        if (msgType === "human") continue;
        
        // Track tool calls (for statistics)
        if (latestMessage.tool_calls && latestMessage.tool_calls.length > 0) {
          for (const tc of latestMessage.tool_calls) {
            const toolName = tc.name || "unknown";
            toolsUsed[toolName] = (toolsUsed[toolName] || 0) + 1;
          }
          res.write(`data: ${JSON.stringify({
            type: "tool_call",
            tools: latestMessage.tool_calls.map((tc: any) => tc.name),
            data: latestMessage.tool_calls
          })}\n\n`);
        }
        
        // Extract content
        let content = "";
        if (latestMessage.content) {
          content = typeof latestMessage.content === "string"
            ? latestMessage.content
            : JSON.stringify(latestMessage.content);
        } else if (latestMessage.text) {
          content = latestMessage.text;
        }
        
        if (content) {
          fullResponse = content;
          res.write(`data: ${JSON.stringify({ type: "message", role: msgType, content })}\n\n`);
        }
      }
    }
    console.timeEnd("supervisor_stream_loop");
    const elapsedTime = Date.now() - startTime;
    console.log(`[Supervisor] Request completed in ${elapsedTime}ms`);

    // Check for pending human-in-the-loop interrupts (durable execution)
    const pendingInterrupts = await getInterruptState(threadId);
    if (pendingInterrupts) {
      console.log(`[HITL] Interrupt detected, awaiting human input:`, pendingInterrupts);
      res.write(`data: ${JSON.stringify({
        type: "interrupt",
        interrupts: pendingInterrupts,
        threadId,
      })}\n\n`);
      res.end();
      return;
    }
    
    // Calculate tokens for this request (for input/output tracking)
    const inputTokens = countTokensApproximately(message);
    const outputTokens = countTokensApproximately(fullResponse);
    const totalTokens = inputTokens + outputTokens;
    
    // Update thread statistics
    const stats = getThreadStats(threadId);
    stats.modelCalls += 1;
    stats.tokens.input += inputTokens;
    stats.tokens.output += outputTokens;
    stats.tokens.total += totalTokens;
    // Context window = current tokens in full conversation (from messages array)
    stats.contextWindowSize = currentContextWindowSize;
    
    // Merge tool calls
    for (const [tool, count] of Object.entries(toolsUsed)) {
      stats.toolCalls[tool] = (stats.toolCalls[tool] || 0) + count;
    }
    
    // Send final event with statistics (matching langchat pattern)
    res.write(`data: ${JSON.stringify({ 
      type: "done", 
      done: true,
      fullResponse,
      statistics: stats
    })}\n\n`);
    res.end();
  } catch (error) {
    console.error("[Chat Error]", error);
    res.write(`data: ${JSON.stringify({ 
      type: "error", 
      error: error instanceof Error ? error.message : "An error occurred" 
    })}\n\n`);
    res.end();
  }
});

/**
 * Resume endpoint for human-in-the-loop (durable execution)
 * After an interrupt pauses the graph, the client sends the human's
 * decision here. Uses Command({ resume }) to continue execution.
 */
app.post("/api/chat/resume", async (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { threadId, resumeValue } = req.body;

  if (!threadId || resumeValue === undefined) {
    res.status(400).json({ error: "threadId and resumeValue are required" });
    return;
  }

  try {
    console.log(`[HITL Resume] Thread: ${threadId}, Value:`, resumeValue);
    let fullResponse = "";

    const stream = await supervisorResume({ threadId, resumeValue });

    for await (const chunk of stream) {
      const state = chunk as any;
      const latestMessage = state.messages?.[state.messages.length - 1];

      if (latestMessage) {
        const msgType = latestMessage._getType?.() || latestMessage.type || "unknown";
        if (msgType === "human") continue;

        if (latestMessage.tool_calls?.length > 0) {
          res.write(`data: ${JSON.stringify({
            type: "tool_call",
            tools: latestMessage.tool_calls.map((tc: any) => tc.name),
          })}\n\n`);
        }

        let content = "";
        if (latestMessage.content) {
          content = typeof latestMessage.content === "string"
            ? latestMessage.content
            : JSON.stringify(latestMessage.content);
        } else if (latestMessage.text) {
          content = latestMessage.text;
        }

        if (content) {
          fullResponse = content;
          res.write(`data: ${JSON.stringify({ type: "message", role: msgType, content })}\n\n`);
        }
      }
    }

    // Check if another interrupt was hit (chained approvals)
    const pendingInterrupts = await getInterruptState(threadId);
    if (pendingInterrupts) {
      res.write(`data: ${JSON.stringify({
        type: "interrupt",
        interrupts: pendingInterrupts,
        threadId,
      })}\n\n`);
      res.end();
      return;
    }

    res.write(`data: ${JSON.stringify({ type: "done", done: true, fullResponse })}\n\n`);
    res.end();
  } catch (error) {
    console.error("[Resume Error]", error);
    res.write(`data: ${JSON.stringify({
      type: "error",
      error: error instanceof Error ? error.message : "An error occurred",
    })}\n\n`);
    res.end();
  }
});

/**
 * Chat endpoint with streaming support
 * Uses Server-Sent Events (SSE) for real-time streaming
 * Uses LangGraph checkpointer for conversation state management
 */
app.post("/api/chat/stream", async (req: Request, res: Response) => {
  const { message, threadId = "default" } = req.body;
  console.log(`[Supervisor] User message: ${message}`);
  if (!message) {
    res.status(400).json({ error: "Message is required" });
    return;
  }

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    const startTime = Date.now();
    
    // Track statistics
    const toolsUsed: Record<string, number> = {};
    let fullResponse = "";
    let currentContextWindowSize = 0;  // Track context window from full messages
    
    const stream = await supervisor.stream(
      { messages: [{ role: "user", content: message }] },
      {
        streamMode: "values",
        configurable: { thread_id: threadId }
      }
    );

    // Send each streamed chunk as an SSE event
    for await (const chunk of stream) {
      // chunk is the full state when using streamMode: "values"
      const state = chunk as any;
      
      // Calculate context window from FULL messages array (not just current request)
      if (state.messages && Array.isArray(state.messages)) {
        currentContextWindowSize = countMessagesTokens(state.messages);
      }
      
      const latestMessage = state.messages?.[state.messages.length - 1];
      
      if (latestMessage) {
        // Track and send tool calls
        if (latestMessage.tool_calls && latestMessage.tool_calls.length > 0) {
          for (const tc of latestMessage.tool_calls) {
            const toolName = tc.name || "unknown";
            toolsUsed[toolName] = (toolsUsed[toolName] || 0) + 1;
          }
          res.write(
            `data: ${JSON.stringify({
              type: "tool_call",
              tools: latestMessage.tool_calls.map((tc: any) => tc.name),
              data: latestMessage.tool_calls
            })}\n\n`
          );
        }

        // Send assistant message content
        if (latestMessage.content && latestMessage._getType?.() !== "human") {
          const content = typeof latestMessage.content === "string"
            ? latestMessage.content
            : JSON.stringify(latestMessage.content);
          
          // Update fullResponse with the latest content
          fullResponse = content;
          
          res.write(
            `data: ${JSON.stringify({
              type: "message",
              role: latestMessage._getType?.() || "assistant",
              content
            })}\n\n`
          );
        }
      }
    }

    const elapsedTime = Date.now() - startTime;
    console.log(`[Supervisor] Request completed in ${elapsedTime}ms`);

    // Calculate tokens for this request (for input/output tracking)
    const inputTokens = countTokensApproximately(message);
    const outputTokens = countTokensApproximately(fullResponse);
    const totalTokens = inputTokens + outputTokens;
    
    // Update thread statistics
    const stats = getThreadStats(threadId);
    stats.modelCalls += 1;
    stats.tokens.input += inputTokens;
    stats.tokens.output += outputTokens;
    stats.tokens.total += totalTokens;
    // Context window = current tokens in full conversation (from messages array)
    stats.contextWindowSize = currentContextWindowSize;
    
    // Merge tool calls
    for (const [tool, count] of Object.entries(toolsUsed)) {
      stats.toolCalls[tool] = (stats.toolCalls[tool] || 0) + count;
    }

    // Send final event indicating stream complete with statistics
    res.write(`data: ${JSON.stringify({ 
      type: "done",
      done: true,
      fullResponse,
      statistics: stats
    })}\n\n`);
    
    res.end();
  } catch (error) {
    console.error("[Chat Error]", error);
    
    res.write(`data: ${JSON.stringify({ 
      type: "error",
      error: error instanceof Error ? error.message : "An error occurred",
      done: true 
    })}\n\n`);
    
    res.end();
  }
});

/**
 * Non-streaming chat endpoint (fallback)
 * Uses LangGraph checkpointer for conversation state management
 */
app.post("/api/chat", async (req: Request, res: Response) => {
  const { message, threadId = "default" } = req.body;

  if (!message) {
    res.status(400).json({ error: "Message is required" });
    return;
  }

  try {
    // Use checkpointer with thread_id for conversation persistence
    const config = {
      configurable: {
        thread_id: threadId,
      },
    };

    // Track elapsed time for supervisor invoke
    const startTime = Date.now();
    const result = await supervisor.invoke(
      { messages: [{ role: "user", content: message }] },
      config
    );
    const elapsedTime = Date.now() - startTime;
    console.log(`[Supervisor] Request completed in ${elapsedTime}ms`);

    const responseMessages = result.messages;
    const lastMessage = responseMessages[responseMessages.length - 1];
    const response = lastMessage.text;

    //console.log(`[Chat Response] Assistant: ${response.substring(0, 100)}...`);

    res.json({
      response,
      threadId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Chat Error]", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "An error occurred",
    });
  }
});

/**
 * Get agent information
 */
app.get("/api/agents", (req: Request, res: Response) => {
  res.json({
    supervisor: {
      name: "Supervisor Agent",
      description: "Coordinates specialized worker agents",
      capabilities: [
        "Task analysis and delegation",
        "Multi-agent orchestration",
        "Response synthesis",
      ],
    },
    workers: [
      {
        name: "JIRA Agent",
        description: "JIRA issue tracking and project management specialist",
        tools: ["jira_team_search", "jira_issue_detail", "jira_my_issue_search"],
      },
      {
        name: "Research Agent",
        description: "Information retrieval and analysis specialist",
        tools: ["research_information", "analyze_text"],
      },
      {
        name: "Calculator Agent",
        description: "Mathematical computation specialist",
        tools: ["calculate"],
      },
    ],
  });
});

// Serve the UI
app.get("/", (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// Start the server
app.listen(port, () => {
  console.log(`\n🚀 Multi-Agent Supervisor Application`);
  console.log(`📡 Server running at http://localhost:${port}`);
  console.log(`💬 Open your browser to start chatting\n`);
  console.log(`Available endpoints:`);
  console.log(`  - GET  /              - Chat interface`);
  console.log(`  - GET  /api/health    - Health check`);
  console.log(`  - GET  /api/agents    - Agent information`);
  console.log(`  - POST /api/chat        - Non-streaming chat`);
  console.log(`  - POST /api/chat/stream - Streaming chat (SSE)`);
  console.log(`  - POST /api/chat/resume - Resume after HITL interrupt (SSE)\n`);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n👋 Shutting down gracefully...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n👋 Shutting down gracefully...");
  process.exit(0);
});

