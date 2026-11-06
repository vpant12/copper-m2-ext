"use server";

// Module 2: the server action the Ask Copper chat calls. It streams the
// conversation to the model through callStream (lib/ai/call.ts), with or
// without the tools, and sends back each step as it happens, so the panel can
// show Copper thinking and using its tools. The contract is in
// specs/module-2/spec.md.
import { stepCountIs } from "ai";
import { callStream, THOUGHT_SUMMARIES } from "@/lib/ai/call";
import { createLive, type Live } from "@/lib/ai/live";
import { COPPER_INSTRUCTIONS } from "@/lib/copper/assistant/instructions";
import type { Progress, Step, ToolStep } from "@/lib/copper/assistant/progress";
import { copperTools, extensionTools } from "@/lib/copper/assistant/tools";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type AskCopperRequest = {
  messages: ChatMessage[];
  useTools: boolean;
};

export type AskCopperResult = { progress: Live<Progress> };

/** At most this many model steps (tool calls plus the reply) per question. */
const MAX_STEPS = 5;

const EMPTY_REPLY =
  "Sorry, I couldn't come up with an answer to that. Could you try asking another way?";
const ERROR_REPLY =
  "Sorry, something went wrong on my end. Please try again in a moment.";

export async function askCopper(
  request: AskCopperRequest,
): Promise<AskCopperResult> {
  const progress = createLive<Progress>();
  // Return straight away; the answer streams in through `progress`.
  void streamAnswer(request, progress);
  return { progress: progress.live };
}

async function streamAnswer(
  { messages, useTools }: AskCopperRequest,
  progress: ReturnType<typeof createLive<Progress>>,
) {
  const steps: Step[] = [];
  let reply = "";

  // A fresh copy every time, so earlier updates never change underneath the reader.
  const snapshot = (status: Progress["status"]): Progress => ({
    steps: steps.map((step) => ({ ...step })),
    reply,
    status,
  });
  const update = () => progress.update(snapshot("working"));
  const toolStep = (id: string) =>
    steps.find(
      (step): step is ToolStep => step.type === "tool" && step.id === id,
    );

  try {
    const history = messages.map(({ role, content }) => ({ role, content }));
    const result = useTools
      ? callStream(
          { module: 2, feature: "ask-copper" },
          {
            instructions: COPPER_INSTRUCTIONS,
            messages: history,
            tools: { ...copperTools, ...extensionTools },
            stopWhen: stepCountIs(MAX_STEPS),
            providerOptions: THOUGHT_SUMMARIES,
          },
        )
      : // Tools off: just the conversation, so the model answers from memory.
        callStream(
          { module: 2, feature: "ask-copper" },
          { messages: history, providerOptions: THOUGHT_SUMMARIES },
        );

    update();
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "reasoning-delta": {
          const last = steps.at(-1);
          if (last?.type === "thinking") last.text += part.text;
          else steps.push({ type: "thinking", text: part.text });
          break;
        }
        case "tool-input-start":
          steps.push({
            type: "tool",
            id: part.id,
            name: part.toolName,
            state: "calling",
          });
          break;
        case "tool-call": {
          const step = toolStep(part.toolCallId);
          if (step) step.input = part.input;
          else
            steps.push({
              type: "tool",
              id: part.toolCallId,
              name: part.toolName,
              state: "calling",
              input: part.input,
            });
          break;
        }
        case "tool-result": {
          const step = toolStep(part.toolCallId);
          if (step) {
            step.output = part.output;
            step.state = "done";
          }
          break;
        }
        case "tool-error": {
          const step = toolStep(part.toolCallId);
          if (step) {
            step.output =
              part.error instanceof Error
                ? part.error.message
                : String(part.error);
            step.state = "error";
          }
          break;
        }
        case "text-delta":
          reply += part.text;
          break;
        case "error":
          throw part.error;
        default:
          continue;
      }
      update();
    }

    if (!reply.trim()) reply = EMPTY_REPLY;
    progress.done(snapshot("done"));
  } catch (error) {
    console.error("[ask-copper]", error);
    if (!reply.trim()) reply = ERROR_REPLY;
    progress.done(snapshot("error"));
  }
}
