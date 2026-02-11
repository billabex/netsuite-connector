/**
 * full_sync.js
 * MapReduce script for full synchronization of all customers
 * with unpaid invoices/credit memos to Billabex.
 * Can be triggered from the setup page at any time for reconciliation.
 *
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 */
define([
    './libs/sync',
    'N/query',
    'N/log',
    'N/runtime'
], (
    sync,
    query,
    log,
    runtime
) => {

    /**
     * Input stage: find all customers with unpaid invoices or open credit memos
     * Uses runSuiteQLPaged to handle more than 5000 customers (default limit)
     */
    const getInputData = () => {
        log.audit({ title: 'full_sync.getInputData', details: 'Starting full sync' });

        const pagedData = query.runSuiteQLPaged({
            query: `SELECT DISTINCT t.entity AS customer_id
                FROM transaction t
                WHERE t.type IN ('CustInvc', 'CustCred')
                  AND (
                    (t.type = 'CustInvc' AND BUILTIN.CF(t.status) = 'CustInvc:A')
                    OR
                    (t.type = 'CustCred' AND BUILTIN.CF(t.status) = 'CustCred:A')
                  )
                  AND t.entity IS NOT NULL`,
            pageSize: 1000
        });

        const customerIds = [];
        for (let i = 0; i < pagedData.pageRanges.length; i++) {
            const page = pagedData.fetch(i);
            page.data.results.forEach(row => {
                customerIds.push(row.asMap().customer_id);
            });
        }

        log.audit({
            title: 'full_sync.getInputData',
            details: `Found ${customerIds.length} customers to sync (${pagedData.pageRanges.length} pages)`
        });

        return customerIds;
    };

    /**
     * Map stage: sync each customer (account + contacts + invoices + credit memos + allocations)
     */
    const map = (context) => {
        const customerId = context.value;

        log.debug({ title: 'full_sync.map', details: `Syncing customer ${customerId}` });

        try {
            const bbxAccountId = sync.syncFullAccount(customerId);

            context.write({
                key: customerId,
                value: JSON.stringify({ status: 'success', bbxAccountId })
            });
        } catch (e) {
            log.error({
                title: 'full_sync.map error',
                details: `Customer ${customerId}: ${e.name} - ${e.message}`
            });

            sync.logOperation({
                operation: 'syncFullAccount',
                recordType: 'customer',
                recordId: customerId,
                status: 'error',
                message: `${e.name}: ${e.message}`
            });

            // Queue for retry
            sync.enqueueSync('customer', customerId, 'sync');

            context.write({
                key: customerId,
                value: JSON.stringify({ status: 'error', error: e.message })
            });
        }

        // Check remaining governance
        const remainingUsage = runtime.getCurrentScript().getRemainingUsage();
        if (remainingUsage < 1000) {
            log.audit({
                title: 'full_sync.map',
                details: `Low governance remaining: ${remainingUsage}. Stopping.`
            });
        }
    };

    /**
     * Summarize stage: log final results
     */
    const summarize = (summary) => {
        let successCount = 0;
        let errorCount = 0;

        summary.output.iterator().each((key, value) => {
            const result = JSON.parse(value);
            if (result.status === 'success') {
                successCount++;
            } else {
                errorCount++;
            }
            return true;
        });

        log.audit({
            title: 'full_sync.summarize',
            details: `Full sync completed. Success: ${successCount}, Errors: ${errorCount}`
        });

        // Log any map stage errors
        if (summary.mapSummary.errors) {
            summary.mapSummary.errors.iterator().each((key, error) => {
                log.error({
                    title: 'full_sync.summarize map error',
                    details: `Key: ${key}, Error: ${error}`
                });
                return true;
            });
        }

        log.audit({
            title: 'full_sync.summarize usage',
            details: `Total map keys processed: ${successCount + errorCount}, ` +
                `Concurrency: ${summary.concurrency}, ` +
                `Yields: ${summary.yields}`
        });
    };

    return { getInputData, map, summarize };
});
