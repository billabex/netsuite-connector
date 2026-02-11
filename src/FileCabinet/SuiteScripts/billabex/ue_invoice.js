/**
 * ue_invoice.js
 * UserEvent script to sync Invoice records to Billabex Invoices
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
        // Handle CREATE, EDIT, and DELETE
        if (context.type !== context.UserEventType.CREATE &&
            context.type !== context.UserEventType.EDIT &&
            context.type !== context.UserEventType.DELETE) {
            return;
        }

        try {
            const connection = getConnection('default');
            if (!connection.isConnected() || !connection.hasOrganization()) return;

            // Handle DELETE: remove invoice from Billabex
            if (context.type === context.UserEventType.DELETE) {
                const bbxInvoiceId = context.oldRecord.getValue({ fieldId: 'custbody_bbx_invoice_id' });
                if (bbxInvoiceId) {
                    sync.deleteInvoice(bbxInvoiceId);
                }
                return;
            }

            // Handle CREATE/EDIT: sync invoice
            const invoiceId = context.newRecord.id;
            sync.syncInvoice(invoiceId);
        } catch (e) {
            log.error({
                title: 'ue_invoice.afterSubmit',
                details: `${e.name}: ${e.message}`
            });
            try {
                if (context.type === context.UserEventType.DELETE) {
                    const bbxInvoiceId = context.oldRecord.getValue({ fieldId: 'custbody_bbx_invoice_id' });
                    if (bbxInvoiceId) {
                        sync.enqueueDelete('invoice', bbxInvoiceId);
                    }
                } else {
                    sync.enqueueSync('invoice', context.newRecord.id, context.type === context.UserEventType.CREATE ? 'create' : 'update');
                }
            } catch (queueError) {
                log.error({ title: 'ue_invoice queue error', details: queueError.message });
            }
        }
    };

    return { afterSubmit };
});
