import { LogEntry, RecentChanges } from '../agent/types.js';

const getLogsAndChanges = async (logFileNumber: number): Promise<{ logs: LogEntry[], changes: RecentChanges[] }> => {
    const getLogFileName = () => `log_set_${logFileNumber}.ts`;
    const logFile = (await import(`../prod_logs/${getLogFileName()}`));

    return { logs: logFile.LOGS, changes: logFile.RECENT_CHANGES };
};

export const loadLogs = async (logFileNumber: number): Promise<LogEntry[]> => {
    const logs = await getLogsAndChanges(logFileNumber);
    return logs.logs;
};

export const loadRecentChanges = async (logFileNumber: number): Promise<RecentChanges[]> => {
    const logs = await getLogsAndChanges(logFileNumber);
    return logs.changes;
};

