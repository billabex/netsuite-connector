/**
 * ue_customer_payment.js
 * UserEvent script to sync Customer Payment records to Billabex
 * Updates paidAmount on all applied invoices
 *
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define([
    './libs/sync',
    './libs/connection',
    'N/log'
], (
    sync,
    { getConnection },
    log
) => {

    const afterSubmit = (context) => {
        if (context.type !== context.UserEventType.CREATE &&
            context.type !== context.UserEventType.EDIT &&
            context.type !== context.UserEventType.DELETE) {
            return;
        }

        try {
            const connection = getConnection('default');
            if (!connection.isConnected() || !connection.hasOrganization()) return;

            // Handle DELETE: re-sync affected invoices to recalculate paidAmount
            // When a payment is deleted, NetSuite updates the invoices' amountremaining
            // We need to re-sync those invoices to update paidAmount in Billabex
            if (context.type === context.UserEventType.DELETE) {
                const applyCount = context.oldRecord.getLineCount({ sublistId: 'apply' });

                for (let i = 0; i < applyCount; i++) {
                    const wasApplied = context.oldRecord.getSublistValue({
                        sublistId: 'apply', fieldId: 'apply', line: i
                    });

                    if (!wasApplied) continue;

                    const invoiceId = context.oldRecord.getSublistValue({
                        sublistId: 'apply', fieldId: 'internalid', line: i
                    });

                    if (invoiceId) {
                        try {
                            // Re-sync the invoice to update paidAmount in Billabex
                            sync.syncInvoice(invoiceId);
                        } catch (invoiceErr) {
                            log.error({
                                title: 'ue_customer_payment.afterSubmit DELETE',
                                details: `Failed to re-sync invoice ${invoiceId}: ${invoiceErr.message}`
                            });
                            // Enqueue for retry
                            sync.enqueueSync('invoice', invoiceId, 'update');
                        }
                    }
                }
                return;
            }

            // Handle CREATE/EDIT: sync payment (updates paidAmount on applied invoices)
            const paymentId = context.newRecord.id;
            sync.syncPayment(paymentId);
        } catch (e) {
            log.error({
                title: 'ue_customer_payment.afterSubmit',
                details: `${e.name}: ${e.message}`
            });
            try {
                // For DELETE errors, we can't do much - the invoices should be re-synced
                // by the next full sync or when they're individually edited
                if (context.type !== context.UserEventType.DELETE) {
                    sync.enqueueSync('customerpayment', context.newRecord.id, 'update');
                }
            } catch (queueError) {
                log.error({ title: 'ue_customer_payment queue error', details: queueError.message });
            }
        }
    };

    return { afterSubmit };
});
