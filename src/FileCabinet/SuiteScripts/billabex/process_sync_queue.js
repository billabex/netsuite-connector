/**
 * process_sync_queue.js
 * Scheduled script that processes the Billabex sync queue.
 * Retries failed sync operations (max 5 retries per entry).
 * Runs every 30 minutes.
 *
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * @NModuleScope SameAccount
 */
define([
    './libs/sync',
    './libs/connection',
    'N/query',
    'N/record',
    'N/log',
    'N/runtime'
], (
    sync,
    { getConnection },
    query,
    record,
    log,
    runtime
) => {

    const MAX_RETRIES = 5;

    /**
     * Dispatch a queue entry to the appropriate sync function
     * @param {string} recordType
     * @param {string} recordId - For sync actions: NS record ID. For delete actions: BBX ID (or JSON for contacts)
     * @param {string} action
     */
    const dispatch = (recordType, recordId, action) => {
        // Handle delete actions - recordId contains the Billabex ID (not NS ID)
        if (action === 'delete') {
            switch (recordType) {
                case 'customer':
                    sync.deleteAccount(recordId);
                    break;
                case 'contact':
                    // For contacts, recordId is JSON: { accountId, contactId }
                    const contactData = JSON.parse(recordId);
                    sync.deleteContact(contactData.accountId, contactData.contactId);
                    break;
                case 'invoice':
                    sync.deleteInvoice(recordId);
                    break;
                case 'creditmemo':
                    sync.deleteCreditMemo(recordId);
                    break;
                default:
                    throw new Error(`Delete not supported for record type: ${recordType}`);
            }
            return;
        }

        // Handle sync actions - recordId is the NetSuite record ID
        switch (recordType) {
            case 'customer':
                if (action === 'sync') {
                    sync.syncFullAccount(recordId);
                } else {
                    sync.syncAccount(recordId);
                }
                break;
            case 'contact':
                sync.syncContact(recordId);
                break;
            case 'invoice':
                sync.syncInvoice(recordId);
                break;
            case 'creditmemo':
                sync.syncCreditMemo(recordId);
                sync.syncCreditAllocations(recordId);
                break;
            case 'customerpayment':
                sync.syncPayment(recordId);
                break;
            default:
                throw new Error(`Unknown record type: ${recordType}`);
        }
    };

    const execute = (context) => {
        const connection = getConnection('default');
        if (!connection.isConnected() || !connection.hasOrganization()) {
            log.debug({
                title: 'process_sync_queue',
                details: 'Connection not set up, skipping queue processing'
            });
            return;
        }

        // Get all pending and failed (with retries left) queue entries
        // Use runSuiteQLPaged to handle more than 5000 entries
        const pagedData = query.runSuiteQLPaged({
            query: `SELECT
                q.id,
                q.custrecord_bbx_sq_record_type AS record_type,
                q.custrecord_bbx_sq_record_id AS record_id,
                q.custrecord_bbx_sq_action AS action,
                q.custrecord_bbx_sq_retry_count AS retry_count
            FROM customrecord_bbx_sync_queue q
            WHERE q.custrecord_bbx_sq_status IN ('pending', 'failed')
              AND (q.custrecord_bbx_sq_retry_count IS NULL OR q.custrecord_bbx_sq_retry_count < ${MAX_RETRIES})
            ORDER BY q.id ASC`,
            pageSize: 1000
        });

        const entries = [];
        for (let i = 0; i < pagedData.pageRanges.length; i++) {
            const page = pagedData.fetch(i);
            page.data.results.forEach(row => {
                entries.push(row.asMap());
            });
        }

        if (entries.length === 0) {
            log.debug({ title: 'process_sync_queue', details: 'No pending items in queue' });
            return;
        }

        log.audit({
            title: 'process_sync_queue',
            details: `Processing ${entries.length} queue entries (${pagedData.pageRanges.length} pages)`
        });

        let processed = 0;
        let succeeded = 0;
        let failed = 0;

        for (const entry of entries) {
            // Check governance
            const remaining = runtime.getCurrentScript().getRemainingUsage();
            if (remaining < 500) {
                log.audit({
                    title: 'process_sync_queue',
                    details: `Stopping due to low governance: ${remaining} remaining. Processed ${processed}/${entries.length}`
                });
                break;
            }

            const queueId = entry.id;
            const recordType = entry.record_type;
            const recordId = entry.record_id;
            const action = entry.action;
            const retryCount = parseInt(entry.retry_count, 10) || 0;

            // Mark as processing
            try {
                record.submitFields({
                    type: 'customrecord_bbx_sync_queue',
                    id: queueId,
                    values: { custrecord_bbx_sq_status: 'processing' }
                });
            } catch (e) {
                log.error({ title: 'process_sync_queue mark processing', details: e.message });
                continue;
            }

            try {
                dispatch(recordType, recordId, action);

                // Success - delete the queue entry
                record.delete({ type: 'customrecord_bbx_sync_queue', id: queueId });
                succeeded++;
            } catch (e) {
                log.error({
                    title: 'process_sync_queue dispatch error',
                    details: `${recordType}:${recordId} (attempt ${retryCount + 1}): ${e.message}`
                });

                const newRetryCount = retryCount + 1;
                const newStatus = newRetryCount >= MAX_RETRIES ? 'failed' : 'pending';

                try {
                    record.submitFields({
                        type: 'customrecord_bbx_sync_queue',
                        id: queueId,
                        values: {
                            custrecord_bbx_sq_status: newStatus,
                            custrecord_bbx_sq_retry_count: newRetryCount,
                            custrecord_bbx_sq_error: `${e.name}: ${e.message}`.substring(0, 4000)
                        }
                    });
                } catch (updateError) {
                    log.error({ title: 'process_sync_queue update error', details: updateError.message });
                }

                failed++;
            }

            processed++;
        }

        log.audit({
            title: 'process_sync_queue complete',
            details: `Processed: ${processed}, Succeeded: ${succeeded}, Failed: ${failed}`
        });
    };

    return { execute };
});
