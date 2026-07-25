import { tool, generateText, stepCountIs, zodSchema } from "ai";
import { z } from "zod";
import chalk from "chalk";
import { LogEntry, RecentChanges } from "./types.js";
import "dotenv/config";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  loadLogs,
  loadRecentChanges,
} from "../services/logsAndChangesService.js";

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

type SearchLogsByIdentifierInput = {
  identifier: string;
  limit?: number;
};

type SearchLogsByIdentifierResult = {
  ok: true;
  identifier: string;
  totalMatches: number;
  matches: Array<{
    time: string;
    service: string;
    level: string;
    msg: string;
    matchedValue: string;
  }>;
  summary: string;
};

type GetRecentChangesInput = {
  limit?: number;
};

type GetRecentChangesResult = {
  ok: true;
  totalChanges: number;
  changes: RecentChanges[];
  summary: string;
};

const createSearchLogsByIdentifierTool = (allLogs: LogEntry[]) =>
  tool({
    description:
      "Search the full log history for an identifier such as user_id, batch_id, request_id, or source_id.",
    inputSchema: zodSchema(
      z.object({
        identifier: z.string().describe("Identifier or text to search for"),
        limit: z
          .number()
          .int()
          .positive()
          .max(20)
          .optional()
          .describe("Maximum number of matching entries to return"),
      }),
    ),
    execute: async ({
      identifier,
      limit = 10,
    }: SearchLogsByIdentifierInput): Promise<SearchLogsByIdentifierResult> => {
      const normalizedIdentifier = identifier.trim().toLowerCase();
      const matches = allLogs
        .flatMap((entry) => {
          const entryData = entry as LogEntry & Record<string, unknown>;
          const searchableValues = Object.entries(entryData)
            .filter(
              ([, value]) =>
                typeof value === "string" || typeof value === "number",
            )
            .map(([key, value]) => `${key}:${String(value)}`);

          const matchedValue = searchableValues.find((value) =>
            value.toLowerCase().includes(normalizedIdentifier),
          );

          if (!matchedValue) {
            return [];
          }

          return [
            {
              time: entry.time,
              service: entry.service,
              level: entry.level,
              msg: entry.msg,
              matchedValue,
            },
          ];
        })
        .slice(0, limit);

      return {
        ok: true,
        identifier,
        totalMatches: matches.length,
        matches,
        summary: `Found ${matches.length} matching log entries for "${identifier}".`,
      };
    },
  });

const createGetRecentChangesTool = (recentChanges: RecentChanges[]) =>
  tool({
    description:
      "Inspect recent deployments or configuration changes that may explain an incident.",
    inputSchema: zodSchema(
      z.object({
        limit: z
          .number()
          .int()
          .positive()
          .max(10)
          .optional()
          .describe("Maximum number of changes to return"),
      }),
    ),
    execute: async ({
      limit = 5,
    }: GetRecentChangesInput): Promise<GetRecentChangesResult> => {
      const changes = recentChanges.slice(0, limit);
      return {
        ok: true,
        totalChanges: changes.length,
        changes,
        summary: `Retrieved ${changes.length} recent changes.`,
      };
    },
  });

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

    const allLogs = (await loadLogs(this.logsFileNumber)) as LogEntry[];
    const recentChanges = (await loadRecentChanges(
      this.logsFileNumber,
    )) as RecentChanges[];

    const systemPrompt = [
      "You are an expert Senior Site Reliability Engineer (SRE) specializing in log analysis.",
      "Investigate the provided logs carefully and prefer concise, evidence-based summaries.",
      "Keep the initial analysis compact but use available tools to inspect broader evidence when needed.",
      "Do not invent facts. If you identify a clear incident, create a ticket using the createTicket tool.",
      "Use the searchLogsByIdentifier tool to inspect full historical logs for identifiers such as user_id, batch_id, request_id, or source_id.",
      "Use the getRecentChanges tool when a deployment or config change may explain the incident.",
    ].join(" ");

    const messages = [
      { role: "system" as const, content: systemPrompt },
      {
        role: "user" as const,
        content: `Analyze the following recent production logs for Log Set #${this.logsFileNumber}:\n\n${recentLogsText}`,
      },
    ];

    const toolActivityLog: string[] = [];

    try {
      const tools = {
        createTicket: createTicketTool,
        recordInvestigationNote: recordInvestigationNoteTool,
        searchLogsByIdentifier: createSearchLogsByIdentifierTool(allLogs),
        getRecentChanges: createGetRecentChangesTool(recentChanges),
      };

      const response = await generateText({
        model: google("gemini-flash-latest"),
        messages,
        tools,
        toolChoice: "auto",
        stopWhen: stepCountIs(3),
        maxRetries: 0,
        temperature: 0.1,
        maxOutputTokens: 1000,
        onStepFinish: ({ toolCalls }) => {
          if (toolCalls.length > 0) {
            const stepSummary = toolCalls
              .map((call) => `- ${call.toolName}`)
              .join("\n");
            toolActivityLog.push(stepSummary);
          }
        },
      });

      const toolSummary =
        toolActivityLog.length > 0
          ? `\n\nTool activity:\n${toolActivityLog.join("\n")}`
          : "";
      const responseText = (response.text ?? "").trim();
      const finalText = responseText.includes("Tool activity")
        ? responseText
        : `${responseText}${toolSummary}`.trim();

      console.log(chalk.green(`\n🤖 Agent Final Answer:\n${finalText}`));
      return finalText || "No analysis generated.";
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
