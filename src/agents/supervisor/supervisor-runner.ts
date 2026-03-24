import supervisor from "./supervisor.js";
import { Command, INTERRUPT } from "@langchain/langgraph";
import { parseUserRole, type UserRole } from "../../poc/rbacMiddleware.js";
import { normalizeInterruptPayloads } from "../../poc/streamInterrupts.js";

export async function supervisorAgent(options: {
    message: string;
    threadId?: string;
    /** Step 2 RBAC: filters tools per role (missing → viewer) */
    userRole?: UserRole;
}): Promise<AsyncIterable<any>> {
    const { message, threadId, userRole } = options;
    const role = parseUserRole(userRole);

    const stream = await supervisor.stream(
        { messages: [{ role: "user", content: message }] }, 
        {
            configurable: { thread_id: threadId },
            streamMode: "values",
            recursionLimit: 50,
            context: { userRole: role },
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
    userRole?: UserRole;
}): Promise<AsyncIterable<any>> {
    const { threadId, resumeValue, userRole } = options;
    const role = parseUserRole(userRole);

    const stream = await supervisor.stream(
        new Command({ resume: resumeValue }),
        {
            configurable: { thread_id: threadId },
            streamMode: "values",
            recursionLimit: 50,
            context: { userRole: role },
        }
    );

    return stream;
}

/**
 * Fallback when the client did not observe `__interrupt__` on streamed chunks (e.g. older graphs).
 * Prefer {@link foldStreamInterruptChunk} from `streamInterrupts.ts` for accurate pending detection.
 */
export async function getInterruptState(threadId: string) {
    const state: any = await supervisor.getState({
        configurable: { thread_id: threadId },
    });

    const values = state.values;
    if (values && typeof values === "object" && INTERRUPT in values) {
        const arr = values[INTERRUPT];
        if (Array.isArray(arr) && arr.length > 0) {
            return normalizeInterruptPayloads(arr);
        }
        return null;
    }

    const fromTasks = (state.tasks || [])
        .flatMap((t: any) => t.interrupts || [])
        .map((i: any) => (i?.value !== undefined ? i.value : i));

    return fromTasks.length > 0 ? fromTasks : null;
}
