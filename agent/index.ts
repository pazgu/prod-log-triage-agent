import { tool, generateText, zodSchema } from "ai";
import { z } from "zod";
import chalk from "chalk";
import { LogEntry } from "./types.js";
import "dotenv/config";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { loadLogs } from "../services/logsAndChangesService.js";

const createTicketTool = tool({
  description: "Create a lightweight ticket for a suspected production issue.",
  inputSchema: zodSchema(
    z.object({
      title: z.string().describe("Concise title of the incident"),
      summary: z.string().describe("Root cause summary based on evidence"),
      severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    }),
  ),
  execute: async ({
    title,
    summary,
    severity,
  }: {
    title: string;
    summary: string;
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  }) => {
    const ticketId = `TICKET-${Math.floor(1000 + Math.random() * 9000)}`;
    console.log(
      chalk.yellow(
        `📝 [Tool Action] Ticket Created: ${ticketId} (${severity})`,
      ),
    );
    return { ok: true, ticketId, title, summary, severity };
  },
}) as any;

const recordInvestigationNoteTool = tool({
  description: "Record a short investigation note for the current incident.",
  inputSchema: zodSchema(
    z.object({
      note: z.string().describe("Short note summarizing a relevant finding"),
    }),
  ),
  execute: async ({ note }: { note: string }) => {
    console.log(chalk.cyan(`🗒️ [Tool Action] Investigation Note: ${note}`));
    return { ok: true, note };
  },
}) as any;

const toolRegistry = {
  createTicket: createTicketTool as any,
  recordInvestigationNote: recordInvestigationNoteTool as any,
};

async function executeToolCalls(
  toolCalls: Array<{ toolName: string; input: any }>,
) {
  const toolResponses: string[] = [];

  for (const toolCall of toolCalls) {
    const tool = toolRegistry[toolCall.toolName as keyof typeof toolRegistry];

    if (!tool?.execute) {
      toolResponses.push(
        `Tool error for ${toolCall.toolName}: Tool is not available.`,
      );
      continue;
    }

    try {
      const toolResult = await tool.execute(toolCall.input, {} as any);
      toolResponses.push(
        `Tool result for ${toolCall.toolName}:\n${JSON.stringify(toolResult, null, 2)}`,
      );
    } catch (error) {
      toolResponses.push(
        `Tool error for ${toolCall.toolName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return toolResponses;
}

export class LogTriageAgent {
  private logsFileNumber: number;
  private readonly initialLogs: LogEntry[];

  constructor(logsFileNumber: number, logs: LogEntry[]) {
    this.logsFileNumber = logsFileNumber;
    this.initialLogs = logs;
  }

  async run(): Promise<string> {
    console.log(
      chalk.blue(
        `🚀 Starting investigation for Log Set #${this.logsFileNumber}...`,
      ),
    );

    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error(
        "Missing GOOGLE_GENERATIVE_AI_API_KEY in your .env file.",
      );
    }

    const google = createGoogleGenerativeAI({ apiKey });
    const contextLogs =
      this.initialLogs.length > 0
        ? this.initialLogs
        : await loadLogs(this.logsFileNumber);
    const maxContextLogs = 5;
    const recentLogs = contextLogs.slice(-maxContextLogs);
    const recentLogsText =
      recentLogs
        .map(
          (entry) =>
            `[${entry.time}] ${entry.level} ${entry.service}: ${entry.msg}`,
        )
        .join("\n") || "No recent log entries were provided.";

    const systemPrompt = [
      "You are an expert Senior Site Reliability Engineer (SRE) specializing in log analysis.",
      "Investigate the provided logs carefully and prefer concise, evidence-based summaries.",
      "Keep the initial analysis compact and use only the recent logs provided.",
      "Do not invent facts. If you identify a clear incident, create a ticket using the createTicket tool.",
    ].join(" ");

    const initialMessages = [
      { role: "system" as const, content: systemPrompt },
      {
        role: "user" as const,
        content: `Analyze the following recent production logs for Log Set #${this.logsFileNumber}:\n\n${recentLogsText}`,
      },
    ];

    let messages = [...initialMessages];
    const maxToolTurns = 2;
    let toolTurnCount = 0;

    let response = await generateText({
      model: google("gemini-1.5-flash"),
      system: systemPrompt,
      messages,
      tools: toolRegistry,
      toolChoice: "auto",
      temperature: 0.1,
      maxOutputTokens: 400,
    });

    while (toolTurnCount < maxToolTurns && response.toolCalls?.length) {
      toolTurnCount += 1;

      console.log(
        chalk.yellow(
          `\n🛠️ Tool call(s) requested: ${response.toolCalls
            .map((call) => call.toolName)
            .join(", ")}`,
        ),
      );

      const toolResponses = await executeToolCalls(response.toolCalls);

      messages = [
        ...messages,
        {
          role: "assistant" as const,
          content: response.text || "",
        } as any,
        {
          role: "user" as const,
          content: `${toolResponses.join("\n\n")}\n\nContinue the investigation using this result and the recent logs.`,
        },
      ];

      response = await generateText({
        model: google("gemini-1.5-flash"),
        system: systemPrompt,
        messages,
        tools: toolRegistry,
        toolChoice: "auto",
        temperature: 0.1,
        maxOutputTokens: 400,
      });
    }

    console.log(chalk.green(`\n🤖 Agent Final Answer:\n${response.text}`));
    return response.text || "No analysis generated.";
  }
}
