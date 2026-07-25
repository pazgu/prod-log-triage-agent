import dotenv from "dotenv";
import { LogTriageAgent } from "../agent/index.js";
import { loadLogs } from "./logsAndChangesService.js";

dotenv.config();

// The logs are in increasing order of difficulty for the agent to resolve, so start with #1 and work up to #5
const LOG_FILE_NUMBER = 1;

const activateLogTriageAgent = async (): Promise<string> => {
  const logs = await loadLogs(LOG_FILE_NUMBER);

  const agent = new LogTriageAgent(LOG_FILE_NUMBER, logs.slice(-5)); // Only use the last 5 logs to conserve context
  const answer = await agent.run();

  return answer;
};

activateLogTriageAgent().then(console.log);
