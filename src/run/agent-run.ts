import { createCalculatorAgent } from "../agents/workers.js";


const calculatorAgent = createCalculatorAgent();
const config = {
    configurable: {
        thread_id: "test-run"
    }
};

const config2 = {
    configurable: {
        thread_id: "test-run2"
    }
};

const result = await calculatorAgent.invoke(
    { messages: [{ role: "user", content: "What is 2 + 2?" }] },
    config
);

console.log(result.messages[result.messages.length - 1].content);

const result2 = await calculatorAgent.invoke(
    { messages: [{ role: "user", content: "Now multiply the result by 8" }] },
    config
);
console.log(result2.messages[result2.messages.length - 1].content);