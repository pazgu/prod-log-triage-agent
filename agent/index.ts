import { LogEntry } from "./types.js";
import { deepDelete, sleep } from "../utils/general.js";
import chalk from "chalk";
import { google } from "@ai-sdk/google";
import { generateText, tool, jsonSchema } from "ai";
import process from "process";
import { loadLogs } from "../services/logsAndChangesService.js";
import { z } from "zod";

const createTicketTool = {
  description: "Create a lightweight ticket for a suspected production issue.",
  inputSchema: jsonSchema({
    type: "object",
    properties: {
      title: { type: "string" },
      summary: { type: "string" },
      severity: { type: "string" },
    },
    required: ["title", "summary", "severity"],
  }),
  execute: async ({
    title,
    summary,
    severity,
  }: {
    title: string;
    summary: string;
    severity: string;
  }) => {
    const ticketId = `TICKET-${Math.floor(1000 + Math.random() * 9000)}`;
    console.log(chalk.yellow(`📝 createTicket -> ${ticketId} (${severity})`));
    return {
      ok: true,
      ticketId,
      title,
      summary,
      severity,
    };
  },
};

export class LogTriageAgent {
  private logsFileNumber: number;
  private logs: LogEntry[];

  constructor(logsFileNumber: number, logs: LogEntry[]) {
    this.logsFileNumber = logsFileNumber;
    this.logs = logs;
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
        "Missing GOOGLE_GENERATIVE_AI_API_KEY. Please add it to your .env file.",
      );
    }

    const allLogs = await loadLogs(this.logsFileNumber);
    const recentLogs = allLogs.slice(-5);
    const recentLogsText = recentLogs
      .map(
        (entry) =>
          `[${entry.time}] ${entry.level} ${entry.service}: ${entry.msg}`,
      )
      .join("\n");

    const systemPrompt = [
      "You are an expert Senior Site Reliability Engineer (SRE) specializing in log analysis.",
      "Investigate the most recent logs carefully.",
      "Prefer concise, evidence-based summaries.",
      "Do not invent facts. If the evidence is insufficient, say so clearly.",
      "For now, reason from the provided logs only.",
    ].join(" ");

    const initialMessages = [
      { role: "system" as const, content: systemPrompt },
      {
        role: "user" as const,
        content: [
          `Analyze the following recent production logs for Log Set #${this.logsFileNumber}.`,
          "Use the last 5 log entries only as the initial context to preserve token efficiency.",
          "",
          recentLogsText,
        ].join("\n"),
      },
    ];

    const maxSteps = 3;
    let messages = initialMessages;
    let finalText = "";

    for (let step = 1; step <= maxSteps; step += 1) {
      console.log(chalk.gray(`\n🧠 Step ${step}/${maxSteps}`));

      const response = await generateText({
        model: google("gemini-1.5-flash"),
        system: systemPrompt,
        messages,
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

      finalText = response.text?.trim() || "";

      if (finalText) {
        console.log(chalk.green(`\n🤖 Agent Response:\n${finalText}`));
      }

      break;
    }

    return finalText || "No analysis available.";
  }
}
