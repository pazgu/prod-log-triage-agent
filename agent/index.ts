import { tool, generateText, stepCountIs, zodSchema } from "ai";
import { z } from "zod";
import chalk from "chalk";
import { LogEntry } from "./types.js";
import "dotenv/config";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { loadLogs } from "../services/logsAndChangesService.js";

type TicketSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

type CreateTicketInput = {
  title: string;
  summary: string;
  severity: TicketSeverity;
};

type CreateTicketResult = {
  ok: true;
  ticketId: string;
  title: string;
  summary: string;
  severity: TicketSeverity;
};

type RecordInvestigationNoteInput = {
  note: string;
};

type RecordInvestigationNoteResult = {
  ok: true;
  note: string;
};

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
  }: CreateTicketInput): Promise<CreateTicketResult> => {
    const ticketId = `TICKET-${Math.floor(1000 + Math.random() * 9000)}`;
    console.log(
      chalk.yellow(
        `📝 [Tool Action] Ticket Created: ${ticketId} (${severity})`,
      ),
    );
    return { ok: true, ticketId, title, summary, severity };
  },
});

const recordInvestigationNoteTool = tool({
  description: "Record a short investigation note for the current incident.",
  inputSchema: zodSchema(
    z.object({
      note: z.string().describe("Short note summarizing a relevant finding"),
    }),
  ),
  execute: async ({
    note,
  }: RecordInvestigationNoteInput): Promise<RecordInvestigationNoteResult> => {
    console.log(chalk.cyan(`🗒️ [Tool Action] Investigation Note: ${note}`));
    return { ok: true, note };
  },
});

const toolRegistry = {
  createTicket: createTicketTool,
  recordInvestigationNote: recordInvestigationNoteTool,
};

export class LogTriageAgent {
  private logsFileNumber: number;
  private readonly initialLogs: LogEntry[];

  constructor(logsFileNumber: number, logs: LogEntry[]) {
    this.logsFileNumber = logsFileNumber;
    this.initialLogs = logs;
  }

  // Fallback analysis in case the AI model fails
  // Ensures the agent still provides useful insights based on the recent logs.
  private buildFallbackAnalysis(contextLogs: LogEntry[]): string {
    const recentLogs = contextLogs.slice(-5);
    const errorCount = recentLogs.filter(
      (entry) => entry.level === "ERROR",
    ).length;
    const warningCount = recentLogs.filter(
      (entry) => entry.level === "WARN",
    ).length;
    const suspiciousCount = recentLogs.filter((entry) =>
      /(fail|error|timeout|unavailable|degraded|latency|queue|retry|drop|exception)/i.test(
        entry.msg,
      ),
    ).length;
    const services = Array.from(
      new Set(recentLogs.map((entry) => entry.service)),
    );

    let summary = `Fallback analysis for Log Set #${this.logsFileNumber}: `;

    if (errorCount > 0) {
      summary += `Detected ${errorCount} error event(s) across ${services.join(", ")}.`;
    } else if (warningCount > 0 || suspiciousCount > 0) {
      summary += `Observed ${warningCount + suspiciousCount} warning-like event(s) that may indicate emerging issues.`;
    } else {
      summary += "No obvious incident pattern detected in the recent logs.";
    }

    const evidence = recentLogs
      .map(
        (entry) =>
          `[${entry.time}] ${entry.level} ${entry.service}: ${entry.msg}`,
      )
      .join("\n");

    return `${summary}\n\nRecent evidence:\n${evidence}`;
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

    const messages = [
      { role: "system" as const, content: systemPrompt },
      {
        role: "user" as const,
        content: `Analyze the following recent production logs for Log Set #${this.logsFileNumber}:\n\n${recentLogsText}`,
      },
    ];

    try {
      const response = await generateText({
        model: google("gemini-flash-latest"),
        messages,
        tools: toolRegistry,
        toolChoice: "auto",
        stopWhen: stepCountIs(3),
        maxRetries: 0,
        temperature: 0.1,
        maxOutputTokens: 1000,
      });

      console.log(chalk.green(`\n🤖 Agent Final Answer:\n${response.text}`));
      return response.text || "No analysis generated.";
    } catch (error) {
      const fallbackAnalysis = this.buildFallbackAnalysis(contextLogs);
      console.warn(
        chalk.yellow(
          `⚠️ AI model call failed (${error instanceof Error ? error.message : String(error)}). Using fallback analysis.`,
        ),
      );
      console.log(chalk.yellow(`\n🧠 Fallback Analysis:\n${fallbackAnalysis}`));
      return fallbackAnalysis;
    }
  }
}
