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
});

export class LogTriageAgent {
  private logsFileNumber: number;

  constructor(logsFileNumber: number, _logs: LogEntry[]) {
    this.logsFileNumber = logsFileNumber;
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
    const allLogs = await loadLogs(this.logsFileNumber);
    const maxContextLogs = 5;
    const recentLogs = allLogs.slice(-maxContextLogs);
    const recentLogsText = recentLogs
      .map(
        (entry) =>
          `[${entry.time}] ${entry.level} ${entry.service}: ${entry.msg}`,
      )
      .join("\n");

    const systemPrompt = [
      "You are an expert Senior Site Reliability Engineer (SRE) specializing in log analysis.",
      "Investigate the provided logs carefully and prefer concise, evidence-based summaries.",
      "Do not invent facts. If you identify a clear incident, create a ticket using the createTicket tool.",
    ].join(" ");

    const response = await generateText({
      model: google("gemini-1.5-flash"),
      system: systemPrompt,
      prompt: `Analyze the following recent production logs for Log Set #${this.logsFileNumber}:\n\n${recentLogsText}`,
      tools: {
        createTicket: createTicketTool,
      },
      toolChoice: "auto",
    });

    if (response.toolCalls?.length) {
      console.log(
        chalk.yellow(
          `\n🛠️ Tool call(s) requested: ${response.toolCalls
            .map((call) => call.toolName)
            .join(", ")}`,
        ),
      );
    }

    console.log(chalk.green(`\n🤖 Agent Final Answer:\n${response.text}`));
    return response.text || "No analysis generated.";
  }
}
