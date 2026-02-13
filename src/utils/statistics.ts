/**
 * Statistics tracking utilities
 * Based on https://github.com/christian-bromann/langchat/blob/main/app/contexts/StatisticsContext.tsx
 */

export interface ConversationStatistics {
  toolCalls: Record<string, number>; // tool name -> count
  modelCalls: number;
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  contextWindowSize: number;
}

/**
 * Approximate token count based on character count
 * Rule: 1 token ≈ 4 characters
 * @param text Text to count tokens for
 * @returns Approximate token count
 */
export function countTokensApproximately(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Count tokens from messages array
 * Handles both BaseMessage format and LangGraph native format
 * Based on langchat's countTokensApproximately
 * @param messages Array of messages (BaseMessage[] or plain objects)
 * @returns Approximate token count
 */
export function countMessagesTokens(messages: Array<Record<string, unknown>>): number {
  let totalChars = 0;
  for (const msg of messages) {
    let textContent = "";

    // Handle BaseMessage format and LangGraph native format (has content property directly)
    if ("content" in msg) {
      const content = msg.content;
      if (typeof content === "string") {
        textContent = content;
      } else if (Array.isArray(content)) {
        // Handle array of content blocks (multimodal support)
        textContent = content
          .map((item) => {
            if (typeof item === "string") return item;
            if (item && typeof item === "object" && "type" in item && 
                (item as Record<string, unknown>).type === "text" && "text" in item) {
              return (item as { text: string }).text;
            }
            return "";
          })
          .join("");
      }
    }

    totalChars += textContent.length;
    }
  // Approximate 1 token = 4 characters
  return Math.ceil(totalChars / 4);
}

/**
 * Initialize empty statistics
 */
export function createEmptyStatistics(): ConversationStatistics {
  return {
    toolCalls: {},
    modelCalls: 0,
    tokens: {
      input: 0,
      output: 0,
      total: 0,
    },
    contextWindowSize: 0,
  };
}

/**
 * Merge statistics (for accumulating across requests)
 */
export function mergeStatistics(
  existing: ConversationStatistics,
  newStats: Partial<ConversationStatistics>
): ConversationStatistics {
  return {
    toolCalls: { ...existing.toolCalls, ...newStats.toolCalls },
    modelCalls: existing.modelCalls + (newStats.modelCalls || 0),
    tokens: {
      input: existing.tokens.input + (newStats.tokens?.input || 0),
      output: existing.tokens.output + (newStats.tokens?.output || 0),
      total: existing.tokens.total + (newStats.tokens?.total || 0),
    },
    contextWindowSize: Math.max(
      existing.contextWindowSize,
      newStats.contextWindowSize || 0
    ),
  };
}

