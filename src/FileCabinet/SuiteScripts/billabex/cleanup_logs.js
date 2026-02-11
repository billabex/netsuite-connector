/**
 * cleanup_logs.js
 * Scheduled script that deletes sync log entries older than 30 days.
 * Also cleans up completed queue entries.
 * Runs once per week.
 *
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * @NModuleScope SameAccount
 */
define([
    'N/query',
    'N/record',
    'N/log',
    'N/runtime'
], (
    query,
    record,
    log,
    runtime
) => {

    const RETENTION_DAYS = 30;

    const execute = (context) => {
        log.audit({ title: 'cleanup_logs', details: `Starting cleanup of logs older than ${RETENTION_DAYS} days` });

        // Delete old sync logs (using runSuiteQLPaged to handle >5000 records)
        let deletedLogs = 0;
        try {
            const pagedLogs = query.runSuiteQLPaged({
                query: `SELECT id FROM customrecord_bbx_sync_log
                    WHERE TO_DATE(created, 'YYYY-MM-DD') < SYSDATE - ${RETENTION_DAYS}`,
                pageSize: 1000
            });

            const logIds = [];
            for (let i = 0; i < pagedLogs.pageRanges.length; i++) {
                const page = pagedLogs.fetch(i);
                page.data.results.forEach(row => {
                    logIds.push(row.asMap().id);
                });
            }

            log.audit({
                title: 'cleanup_logs',
                details: `Found ${logIds.length} old logs to delete`
            });

            for (const logId of logIds) {
                const remaining = runtime.getCurrentScript().getRemainingUsage();
                if (remaining < 100) {
                    log.audit({
                        title: 'cleanup_logs',
                        details: `Stopping due to low governance. Deleted ${deletedLogs} logs so far.`
                    });
                    break;
                }

                try {
                    record.delete({ type: 'customrecord_bbx_sync_log', id: logId });
                    deletedLogs++;
                } catch (e) {
                    log.error({ title: 'cleanup_logs delete log', details: e.message });
                }
            }
        } catch (e) {
            log.error({ title: 'cleanup_logs query logs', details: e.message });
        }

        // Delete failed queue entries that have exceeded max retries and are older than 7 days
        // Using runSuiteQLPaged to handle >5000 records
        let deletedQueue = 0;
        try {
            const pagedQueue = query.runSuiteQLPaged({
                query: `SELECT id FROM customrecord_bbx_sync_queue
                    WHERE custrecord_bbx_sq_status = 'failed'
                      AND TO_DATE(created, 'YYYY-MM-DD') < SYSDATE - 7`,
                pageSize: 1000
            });

            const queueIds = [];
            for (let i = 0; i < pagedQueue.pageRanges.length; i++) {
                const page = pagedQueue.fetch(i);
                page.data.results.forEach(row => {
                    queueIds.push(row.asMap().id);
                });
            }

            log.audit({
                title: 'cleanup_logs',
                details: `Found ${queueIds.length} old queue entries to delete`
            });

            for (const queueId of queueIds) {
                const remaining = runtime.getCurrentScript().getRemainingUsage();
                if (remaining < 100) break;

                try {
                    record.delete({ type: 'customrecord_bbx_sync_queue', id: queueId });
                    deletedQueue++;
                } catch (e) {
                    log.error({ title: 'cleanup_logs delete queue', details: e.message });
                }
            }
        } catch (e) {
            log.error({ title: 'cleanup_logs query queue', details: e.message });
        }

        log.audit({
            title: 'cleanup_logs complete',
            details: `Deleted ${deletedLogs} old logs, ${deletedQueue} old queue entries`
        });
    };

    return { execute };
});
