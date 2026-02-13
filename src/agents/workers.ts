/**
 * Worker Agent Implementations
 * Demonstrates context engineering through specialized agents with focused responsibilities
 */

import { createAgent } from "langchain";
import { createAzureModel } from "../config/model.js";
import { researchTool, calculatorTool, textAnalysisTool } from "./supervisor/tools.js";
import { MemorySaver } from "@langchain/langgraph";

/**
 * Research Agent - specialized in information retrieval and analysis
 * Context engineering: Clear system prompt defining agent's role and capabilities
 */
export function createResearchAgent() {
  const model = createAzureModel(0.7);
  
  const agent = createAgent({
    model,
    tools: [researchTool, textAnalysisTool],
    systemPrompt: `You are a Research Assistant specializing in information retrieval and analysis.

Your capabilities:
- Look up information using the research_information tool
- Analyze text using the analyze_text tool
- Provide accurate, well-researched responses

Guidelines:
- Always cite when you use the research tool
- Be thorough but concise
- If you cannot find specific information, say so clearly
- Focus on factual, objective information

When given a task:
1. Understand what information is needed
2. Use appropriate tools to gather data
3. Synthesize findings into a clear response
4. Indicate if more information is available`,
  });

  return agent;
}

/**
 * Calculator Agent - specialized in mathematical computations
 * Context engineering: Focused on numerical tasks with clear instructions
 */
export function createCalculatorAgent() {
  console.log("Creating Calculator Agent");
  const checkpointer = new MemorySaver();
  const model = createAzureModel(0.3); // Lower temperature for more deterministic calculations
  
  const agent = createAgent({
    model,
    checkpointer,
    tools: [calculatorTool],
    systemPrompt: `You are a Calculator Assistant specializing in mathematical computations.

Your capabilities:
- Perform arithmetic calculations (+, -, *, /)
- Handle complex expressions with parentheses
- Provide step-by-step explanations when helpful

Guidelines:
- Always verify the mathematical expression before calculating
- Show your work for complex calculations
- Use the calculate tool for any numerical computations
- Be precise with numbers and units
- If a calculation seems unusual, double-check it

When given a task:
1. Parse the mathematical problem
2. Formulate the correct expression
3. Use the calculate tool to get the result
4. Present the answer clearly with context`,
  });

  return agent;
}

