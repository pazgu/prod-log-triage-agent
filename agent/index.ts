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

    let response = await generateText({
      model: google("gemini-1.5-flash"),
      system: systemPrompt,
      messages,
      tools: {
        createTicket: createTicketTool as any,
      },
      toolChoice: "auto",
      temperature: 0.1,
      maxOutputTokens: 400,
    });

    if (response.toolCalls?.length) {
      console.log(
        chalk.yellow(
          `\n🛠️ Tool call(s) requested: ${response.toolCalls
            .map((call) => call.toolName)
            .join(", ")}`,
        ),
      );

      const toolCall = response.toolCalls[0];
      if (toolCall.toolName === "createTicket") {
        const toolInput = toolCall.input as {
          title?: string;
          summary?: string;
          severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
        };

        const toolResult = await createTicketTool.execute?.(
          {
            title: toolInput.title ?? "Production incident",
            summary:
              toolInput.summary ?? "Incident detected from log analysis.",
            severity: toolInput.severity ?? "MEDIUM",
          },
          {} as any,
        );

        messages = [
          ...messages,
          {
            role: "assistant" as const,
            content: response.text || "",
          } as any,
          {
            role: "user" as const,
            content: `Tool result for createTicket:\n${JSON.stringify(toolResult, null, 2)}\n\nContinue the investigation using this result and the recent logs.`,
          },
        ];

        response = await generateText({
          model: google("gemini-1.5-flash"),
          system: systemPrompt,
          messages,
          tools: {
            createTicket: createTicketTool as any,
          },
          toolChoice: "none",
          temperature: 0.1,
          maxOutputTokens: 400,
        });
      }
    }

    console.log(chalk.green(`\n🤖 Agent Final Answer:\n${response.text}`));
    return response.text || "No analysis generated.";
  }
}
