/**
 * ue_credit_memo.js
 * UserEvent script to sync Credit Memo records to Billabex Credit Notes
 * and handle credit allocations
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

            // Handle DELETE: remove credit note from Billabex
            if (context.type === context.UserEventType.DELETE) {
                const bbxCreditNoteId = context.oldRecord.getValue({ fieldId: 'custbody_bbx_credit_memo_id' });
                if (bbxCreditNoteId) {
                    sync.deleteCreditMemo(bbxCreditNoteId);
                }
                return;
            }

            // Handle CREATE/EDIT: sync credit memo and allocations
            const creditMemoId = context.newRecord.id;

            // Sync the credit memo itself (creates the credit note in Billabex)
            sync.syncCreditMemo(creditMemoId);

            // Sync credit allocations (applications to invoices)
            sync.syncCreditAllocations(creditMemoId);
        } catch (e) {
            log.error({
                title: 'ue_credit_memo.afterSubmit',
                details: `${e.name}: ${e.message}`
            });
            try {
                if (context.type === context.UserEventType.DELETE) {
                    const bbxCreditNoteId = context.oldRecord.getValue({ fieldId: 'custbody_bbx_credit_memo_id' });
                    if (bbxCreditNoteId) {
                        sync.enqueueDelete('creditmemo', bbxCreditNoteId);
                    }
                } else {
                    sync.enqueueSync('creditmemo', context.newRecord.id, context.type === context.UserEventType.CREATE ? 'create' : 'update');
                }
            } catch (queueError) {
                log.error({ title: 'ue_credit_memo queue error', details: queueError.message });
            }
        }
    };

    return { afterSubmit };
});
