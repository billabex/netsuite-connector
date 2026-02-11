/**
 * ue_customer.js
 * UserEvent script to sync Customer records to Billabex Accounts
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

            // Handle DELETE: remove account from Billabex (cascades contacts, invoices, etc.)
            if (context.type === context.UserEventType.DELETE) {
                const bbxAccountId = context.oldRecord.getValue({ fieldId: 'custentity_bbx_id' });
                if (bbxAccountId) {
                    sync.deleteAccount(bbxAccountId);
                }
                return;
            }

            // Handle CREATE/EDIT: sync account and email contacts
            const customerId = context.newRecord.id;
            sync.syncAccount(customerId);
            sync.syncCustomerEmailContacts(customerId);
        } catch (e) {
            log.error({
                title: 'ue_customer.afterSubmit',
                details: `${e.name}: ${e.message}`
            });
            try {
                if (context.type === context.UserEventType.DELETE) {
                    const bbxAccountId = context.oldRecord.getValue({ fieldId: 'custentity_bbx_id' });
                    if (bbxAccountId) {
                        sync.enqueueDelete('customer', bbxAccountId);
                    }
                } else {
                    sync.enqueueSync('customer', context.newRecord.id, context.type === context.UserEventType.CREATE ? 'create' : 'update');
                }
            } catch (queueError) {
                log.error({ title: 'ue_customer queue error', details: queueError.message });
            }
        }
    };

    return { afterSubmit };
});
