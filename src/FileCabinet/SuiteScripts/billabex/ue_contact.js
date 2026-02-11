/**
 * ue_contact.js
 * UserEvent script to sync Contact records to Billabex Contacts
 *
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define([
    './libs/sync',
    './libs/connection',
    'N/record',
    'N/log'
], (
    sync,
    { getConnection },
    record,
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

            // Handle DELETE: remove contact from Billabex
            if (context.type === context.UserEventType.DELETE) {
                const bbxContactId = context.oldRecord.getValue({ fieldId: 'custentity_bbx_contact_id' });
                if (!bbxContactId) return; // Contact was never synced to Billabex

                // Get parent customer's Billabex Account ID
                const customerId = context.oldRecord.getValue({ fieldId: 'company' });
                if (!customerId) return;

                // Try to load the customer to get bbxAccountId
                // If customer was also deleted, the account delete will cascade and handle contacts
                let bbxAccountId;
                try {
                    const customerRec = record.load({ type: 'customer', id: customerId, isDynamic: false });
                    bbxAccountId = customerRec.getValue({ fieldId: 'custentity_bbx_id' });
                } catch (loadErr) {
                    // Customer doesn't exist anymore - account delete will cascade, skip
                    log.debug({
                        title: 'ue_contact.afterSubmit DELETE',
                        details: `Parent customer ${customerId} not found, skipping contact delete (account delete will cascade)`
                    });
                    return;
                }

                if (bbxAccountId) {
                    sync.deleteContact(bbxAccountId, bbxContactId);
                }
                return;
            }

            // Handle CREATE/EDIT: sync contact
            // Only sync contacts that belong to a customer (company field)
            const company = context.newRecord.getValue({ fieldId: 'company' });
            if (!company) return;

            const contactId = context.newRecord.id;
            sync.syncContact(contactId);
        } catch (e) {
            log.error({
                title: 'ue_contact.afterSubmit',
                details: `${e.name}: ${e.message}`
            });
            try {
                if (context.type === context.UserEventType.DELETE) {
                    const bbxContactId = context.oldRecord.getValue({ fieldId: 'custentity_bbx_contact_id' });
                    const customerId = context.oldRecord.getValue({ fieldId: 'company' });
                    if (bbxContactId && customerId) {
                        // Try to get bbxAccountId for queue
                        try {
                            const customerRec = record.load({ type: 'customer', id: customerId, isDynamic: false });
                            const bbxAccountId = customerRec.getValue({ fieldId: 'custentity_bbx_id' });
                            if (bbxAccountId) {
                                sync.enqueueDelete('contact', bbxContactId, bbxAccountId);
                            }
                        } catch (loadErr) {
                            // Customer gone, skip queuing
                        }
                    }
                } else {
                    sync.enqueueSync('contact', context.newRecord.id, context.type === context.UserEventType.CREATE ? 'create' : 'update');
                }
            } catch (queueError) {
                log.error({ title: 'ue_contact queue error', details: queueError.message });
            }
        }
    };

    return { afterSubmit };
});
