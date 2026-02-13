import supervisor from "./supervisor.js";
import { Command } from "@langchain/langgraph";

export async function supervisorAgent(options: {
    message: string;
    threadId?: string;
}): Promise<AsyncIterable<any>> {
    const { message, threadId } = options;
    
    const stream = await supervisor.stream(
        { messages: [{ role: "user", content: message }] }, 
        {
            configurable: { thread_id: threadId },
            streamMode: "values",
            recursionLimit: 50,
        }
    );

    return stream;
}

/**
 * Resume a paused graph after a human-in-the-loop interrupt.
 * Uses Command({ resume }) to pass the human's response back
 * into the interrupt() call that paused execution.
 */
export async function supervisorResume(options: {
    threadId: string;
    resumeValue: any;
}): Promise<AsyncIterable<any>> {
    const { threadId, resumeValue } = options;

    const stream = await supervisor.stream(
        new Command({ resume: resumeValue }),
        {
            configurable: { thread_id: threadId },
            streamMode: "values",
            recursionLimit: 50,
        }
    );

    return stream;
}

/**
 * Check if the supervisor graph has a pending interrupt for a thread.
 * Returns the interrupt payloads if any, or null.
 */
export async function getInterruptState(threadId: string) {
    const state: any = await supervisor.getState({
        configurable: { thread_id: threadId },
    });

    const interrupts = (state.tasks || [])
        .flatMap((t: any) => t.interrupts || [])
        .map((i: any) => i.value);

    return interrupts.length > 0 ? interrupts : null;
}
