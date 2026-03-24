/**
 * JIRA sub-agent uses **Ollama** only; supervisor and other workers use Azure OpenAI (`llm` / `slm`).
 * Configure via `OLLAMA_BASE_URL`, `JIRA_OLLAMA_MODEL` (or `OLLAMA_MODEL`).
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOllama } from "@langchain/ollama";

let jiraOllamaSingleton: BaseChatModel | null = null;

export function createJiraOllamaModel(): BaseChatModel {
  const modelName =
    process.env.JIRA_OLLAMA_MODEL?.trim() ||
    process.env.OLLAMA_MODEL?.trim() ||
    "llama3.2";
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  const temperature = Number(process.env.JIRA_OLLAMA_TEMPERATURE ?? 0);
  console.log(`[JIRA Agent] ChatOllama baseUrl=${baseUrl} model=${modelName}`);
  return new ChatOllama({
    baseUrl,
    model: modelName,
    temperature: Number.isFinite(temperature) ? temperature : 0,
  });
}

/** One shared Ollama client for the JIRA sub-agent (matches supervisor JIRA routing config). */
export function getJiraOllamaModel(): BaseChatModel {
  if (!jiraOllamaSingleton) {
    jiraOllamaSingleton = createJiraOllamaModel();
  }
  return jiraOllamaSingleton;
}
