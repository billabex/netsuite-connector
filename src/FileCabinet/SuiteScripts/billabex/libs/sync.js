/**
 * sync.js
 * Core synchronization module for NetSuite -> Billabex
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([
    './billabex-api',
    './connection',
    './config',
    'N/record',
    'N/query',
    'N/render',
    'N/log'
], (
    { createClient, TokenExpiredError, RateLimitError, ApiError },
    { getConnection },
    { resolveEmail, DEFAULT_LANGUAGE, CONNECTION_ID },
    record,
    query,
    render,
    log
) => {

    // ═══════════════════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Convert a NetSuite date to a Billabex date object { year, month, day }
     * @param {Date|string} nsDate - NetSuite date value
     * @returns {{ year: number, month: number, day: number }|null}
     */
    const toDateValue = (nsDate) => {
        if (!nsDate) return null;
        const d = nsDate instanceof Date ? nsDate : new Date(nsDate);
        if (Number.isNaN(d.getTime())) return null;
        return {
            year: d.getFullYear(),
            month: d.getMonth() + 1,
            day: d.getDate()
        };
    };

    /**
     * Flatten a date value object to a string for multipart form fields.
     * The multipart builder sends each field as a string, but the API
     * expects issuedDate[year], issuedDate[month], issuedDate[day].
     * We return an object with flattened keys.
     * @param {string} prefix - Field name prefix (e.g. 'issuedDate')
     * @param {{ year: number, month: number, day: number }} dateValue
     * @returns {Object} e.g. { 'issuedDate[year]': 2026, 'issuedDate[month]': 1, 'issuedDate[day]': 15 }
     */
    const flattenDateForMultipart = (prefix, dateValue) => {
        if (!dateValue) return {};
        return {
            [`${prefix}[year]`]: dateValue.year,
            [`${prefix}[month]`]: dateValue.month,
            [`${prefix}[day]`]: dateValue.day
        };
    };

    /**
     * Get the Billabex API client for the default connection.
     * Throws if not connected or no organization selected.
     * @returns {{ client: BillabexApiClient, connection: Connection }}
     */
    const getClientAndConnection = () => {
        const connection = getConnection('default');
        if (!connection.isConnected() || !connection.hasOrganization()) {
            throw new Error('Billabex connection is not set up. Please complete the setup first.');
        }
        const client = createClient('default');
        return { client, connection };
    };

    /**
     * Safely load a NetSuite record, returning null if it doesn't exist or can't be loaded.
     * Helps prevent ScriptNullObjectAdapter errors when records are deleted or inaccessible.
     * @param {string} type - Record type (e.g., 'customer', 'invoice')
     * @param {number|string} id - Record internal ID
     * @param {Object} [options] - Additional options for record.load()
     * @returns {Object|null} The loaded record or null if it couldn't be loaded
     */
    const safeLoadRecord = (type, id, options = {}) => {
        if (!id) {
            log.debug({
                title: 'sync.safeLoadRecord',
                details: `Cannot load ${type}: no ID provided`
            });
            return null;
        }
        try {
            return record.load({ type, id, ...options });
        } catch (e) {
            log.debug({
                title: 'sync.safeLoadRecord',
                details: `Could not load ${type} ${id}: ${e.message}`
            });
            return null;
        }
    };

    /**
     * Safely get a value from a subrecord, handling null/undefined subrecords.
     * @param {Object} parentRecord - The parent record
     * @param {string} subrecordFieldId - Field ID of the subrecord
     * @param {string} valueFieldId - Field ID of the value to get from the subrecord
     * @returns {*} The value or null if subrecord doesn't exist
     */
    const safeGetSubrecordValue = (parentRecord, subrecordFieldId, valueFieldId) => {
        try {
            const subrecord = parentRecord.getSubrecord({ fieldId: subrecordFieldId });
            if (subrecord && typeof subrecord.getValue === 'function') {
                return subrecord.getValue({ fieldId: valueFieldId });
            }
        } catch (e) {
            // Subrecord doesn't exist or can't be accessed
        }
        return null;
    };

    /**
     * Compare a Billabex DateValueResponseDto with a NetSuite date.
     * @param {{ year: number, month: number, day: number }} bbxDate - from Billabex API
     * @param {Date|string} nsDate - from NetSuite record
     * @returns {boolean} true if they represent the same date
     */
    const datesEqual = (bbxDate, nsDate) => {
        if (!bbxDate && !nsDate) return true;
        if (!bbxDate || !nsDate) return false;
        const ns = toDateValue(nsDate);
        if (!ns) return false;
        return bbxDate.year === ns.year && bbxDate.month === ns.month && bbxDate.day === ns.day;
    };

    /**
     * Check if an invoice in Billabex has changed compared to the NetSuite record.
     * Compares number, totalAmount, taxAmount, issuedDate, dueDate, poNumber.
     * @param {Object} bbxInvoice - Invoice data from Billabex API
     * @param {Object} nsValues - { tranId, total, taxTotal, tranDate, dueDate, poNumber }
     * @returns {boolean} true if a change is detected
     */
    const invoiceHasChanged = (bbxInvoice, nsValues) => {
        if (bbxInvoice.number !== nsValues.tranId) return true;
        if (bbxInvoice.totalAmount !== nsValues.total) return true;
        if (bbxInvoice.taxAmount !== nsValues.taxTotal) return true;
        if (!datesEqual(bbxInvoice.issuedDate, nsValues.tranDate)) return true;
        if (!datesEqual(bbxInvoice.dueDate, nsValues.dueDate)) return true;
        if ((bbxInvoice.poNumber || '') !== (nsValues.poNumber || '')) return true;
        return false;
    };

    /**
     * Check if a credit note in Billabex has changed compared to the NetSuite record.
     * Compares number, totalAmount, taxAmount, issuedDate.
     * @param {Object} bbxCreditNote - Credit note data from Billabex API
     * @param {Object} nsValues - { tranId, total, taxTotal, tranDate }
     * @returns {boolean} true if a change is detected
     */
    const creditNoteHasChanged = (bbxCreditNote, nsValues) => {
        if (bbxCreditNote.number !== nsValues.tranId) return true;
        if (bbxCreditNote.totalAmount !== nsValues.total) return true;
        if (bbxCreditNote.taxAmount !== nsValues.taxTotal) return true;
        if (!datesEqual(bbxCreditNote.issuedDate, nsValues.tranDate)) return true;
        return false;
    };

    // ═══════════════════════════════════════════════════════════════════════
    // LOGGING
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Log a sync operation to the custom record
     * @param {Object} params
     * @param {string} params.operation - API operation name
     * @param {string} params.recordType - NetSuite record type
     * @param {string} params.recordId - NetSuite internal ID
     * @param {string} [params.bbxId] - Billabex UUID
     * @param {string} params.status - 'success' or 'error'
     * @param {string} [params.message] - Details or error message
     * @param {number} [params.duration] - Duration in ms
     */
    const logOperation = ({ operation, recordType, recordId, bbxId, status, message, duration }) => {
        try {
            const logRec = record.create({ type: 'customrecord_bbx_sync_log' });
            logRec.setValue({ fieldId: 'name', value: `${operation} ${recordType}:${recordId}` });
            logRec.setValue({ fieldId: 'custrecord_bbx_sl_operation', value: operation });
            logRec.setValue({ fieldId: 'custrecord_bbx_sl_record_type', value: recordType });
            logRec.setValue({ fieldId: 'custrecord_bbx_sl_record_id', value: String(recordId) });
            if (bbxId) {
                logRec.setValue({ fieldId: 'custrecord_bbx_sl_bbx_id', value: bbxId });
            }
            logRec.setValue({ fieldId: 'custrecord_bbx_sl_status', value: status });
            if (message) {
                logRec.setValue({ fieldId: 'custrecord_bbx_sl_message', value: String(message).substring(0, 4000) });
            }
            if (duration !== undefined) {
                logRec.setValue({ fieldId: 'custrecord_bbx_sl_duration', value: duration });
            }
            logRec.save();
        } catch (e) {
            log.error({ title: 'sync.logOperation failed', details: e.message });
        }
    };

    // ═══════════════════════════════════════════════════════════════════════
    // SYNC QUEUE
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Add an entry to the sync queue for retry
     * @param {string} recordType - NetSuite record type
     * @param {string|number} recordId - NetSuite internal ID
     * @param {string} action - Action to perform (create, update, delete, sync)
     */
    const enqueueSync = (recordType, recordId, action) => {
        try {
            // Check if there's already a pending/failed entry for this record
            const existing = query.runSuiteQL({
                query: `SELECT id FROM customrecord_bbx_sync_queue
                    WHERE custrecord_bbx_sq_record_type = '${recordType}'
                      AND custrecord_bbx_sq_record_id = '${recordId}'
                      AND custrecord_bbx_sq_status IN ('pending', 'failed')`
            }).results;

            if (existing.length > 0) {
                // Already queued, update the action if needed
                const queueRec = record.load({
                    type: 'customrecord_bbx_sync_queue',
                    id: existing[0].asMap().id
                });
                queueRec.setValue({ fieldId: 'custrecord_bbx_sq_action', value: action });
                queueRec.setValue({ fieldId: 'custrecord_bbx_sq_status', value: 'pending' });
                queueRec.save();
                return;
            }

            const queueRec = record.create({ type: 'customrecord_bbx_sync_queue' });
            queueRec.setValue({ fieldId: 'name', value: `${recordType}:${recordId}` });
            queueRec.setValue({ fieldId: 'custrecord_bbx_sq_record_type', value: recordType });
            queueRec.setValue({ fieldId: 'custrecord_bbx_sq_record_id', value: String(recordId) });
            queueRec.setValue({ fieldId: 'custrecord_bbx_sq_action', value: action });
            queueRec.setValue({ fieldId: 'custrecord_bbx_sq_status', value: 'pending' });
            queueRec.setValue({ fieldId: 'custrecord_bbx_sq_retry_count', value: 0 });
            queueRec.save();
        } catch (e) {
            log.error({ title: 'sync.enqueueSync failed', details: e.message });
        }
    };

    // ═══════════════════════════════════════════════════════════════════════
    // SYNC FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Sync a NetSuite Customer to a Billabex Account
     * @param {number|string} customerId - NetSuite Customer internal ID
     * @returns {string} Billabex Account UUID
     */
    const syncAccount = (customerId) => {
        const startTime = Date.now();
        const { client, connection } = getClientAndConnection();

        const customerRec = safeLoadRecord('customer', customerId);
        if (!customerRec) {
            throw new Error(`Customer ${customerId} could not be loaded (may have been deleted)`);
        }

        const bbxId = customerRec.getValue({ fieldId: 'custentity_bbx_id' });
        const companyName = customerRec.getValue({ fieldId: 'companyname' })
            || customerRec.getValue({ fieldId: 'entityid' });

        // Get currency ISO code
        const currencyId = customerRec.getValue({ fieldId: 'currency' });
        let currencyCode = 'EUR'; // default
        if (currencyId) {
            try {
                const currencyResults = query.runSuiteQL({
                    query: `SELECT symbol FROM currency WHERE id = ${currencyId}`
                }).results;
                if (currencyResults.length > 0) {
                    currencyCode = currencyResults[0].asMap().symbol;
                }
            } catch (e) {
                log.debug({ title: 'sync.syncAccount currency lookup', details: e.message });
            }
        }

        // Get billing address - try subrecord first, then addressbook sublist
        const billingAddress = {};
        let addressFound = false;

        // Method 1: Try defaultbillingaddress subrecord
        try {
            const addrSubrec = customerRec.getSubrecord({ fieldId: 'defaultbillingaddress' });
            if (addrSubrec && typeof addrSubrec.getValue === 'function') {
                const street = addrSubrec.getValue({ fieldId: 'addr1' });
                // Only use this address if we got at least one field (proves subrecord is valid)
                if (street !== undefined) {
                    billingAddress.street = street || null;
                    billingAddress.city = addrSubrec.getValue({ fieldId: 'city' }) || null;
                    billingAddress.postalCode = addrSubrec.getValue({ fieldId: 'zip' }) || null;
                    billingAddress.stateOrProvince = addrSubrec.getValue({ fieldId: 'state' }) || null;
                    billingAddress.country = addrSubrec.getValue({ fieldId: 'country' }) || null;
                    addressFound = true;
                }
            }
        } catch (e) {
            // Subrecord access failed, will try addressbook below
            log.debug({ title: 'sync.syncAccount', details: `defaultbillingaddress subrecord failed: ${e.message}` });
        }

        // Method 2: Fall back to addressbook sublist if subrecord didn't work
        if (!addressFound) {
            try {
                const addrCount = customerRec.getLineCount({ sublistId: 'addressbook' });
                for (let i = 0; i < addrCount; i++) {
                    const isDefault = customerRec.getSublistValue({
                        sublistId: 'addressbook', fieldId: 'defaultbilling', line: i
                    });
                    if (isDefault) {
                        try {
                            const addrSubrec = customerRec.getSublistSubrecord({
                                sublistId: 'addressbook', fieldId: 'addressbookaddress', line: i
                            });
                            if (addrSubrec && typeof addrSubrec.getValue === 'function') {
                                billingAddress.street = addrSubrec.getValue({ fieldId: 'addr1' }) || null;
                                billingAddress.city = addrSubrec.getValue({ fieldId: 'city' }) || null;
                                billingAddress.postalCode = addrSubrec.getValue({ fieldId: 'zip' }) || null;
                                billingAddress.stateOrProvince = addrSubrec.getValue({ fieldId: 'state' }) || null;
                                billingAddress.country = addrSubrec.getValue({ fieldId: 'country' }) || null;
                            }
                        } catch (subrecErr) {
                            log.debug({ title: 'sync.syncAccount', details: `addressbook subrecord failed at line ${i}: ${subrecErr.message}` });
                        }
                        break;
                    }
                }
            } catch (e) {
                log.debug({ title: 'sync.syncAccount', details: `addressbook sublist failed: ${e.message}` });
            }
        }

        let resultBbxId;
        let operation;
        let needsCreate = !bbxId;

        // Source reference to link this account to its NetSuite record
        const sourceRef = {
            connectionId: CONNECTION_ID,
            sourceId: String(customerId)
        };

        // If we have a bbxId, try to update - but handle 404 (orphan reference)
        if (bbxId) {
            try {
                operation = 'accounts.update';
                client.accounts.update(bbxId, {
                    fullName: companyName,
                    currencyCode,
                    billingAddress
                });
                resultBbxId = bbxId;
            } catch (e) {
                if (e.name === 'ApiError' && e.status === 404) {
                    // Account no longer exists in Billabex - clear the reference and create new
                    log.audit({
                        title: 'sync.syncAccount',
                        details: `Account ${bbxId} not found in Billabex (404), will create new`
                    });
                    record.submitFields({
                        type: 'customer',
                        id: customerId,
                        values: { custentity_bbx_id: '' },
                        options: { enableSourcing: false, ignoreMandatoryFields: true }
                    });
                    needsCreate = true;
                } else {
                    throw e; // Re-throw other errors
                }
            }
        }

        // Create new account if needed (either no bbxId initially, or 404 on update)
        if (needsCreate) {
            operation = 'accounts.create';
            const result = client.accounts.create({
                organizationId: connection.organizationId,
                fullName: companyName,
                currencyCode,
                billingAddress,
                contacts: [],
                internalRepresentatives: [],
                source: sourceRef
            });

            resultBbxId = result.data.id;

            // Save the Billabex ID back to the Customer record
            record.submitFields({
                type: 'customer',
                id: customerId,
                values: { custentity_bbx_id: resultBbxId },
                options: { enableSourcing: false, ignoreMandatoryFields: true }
            });
        }

        // Note: source reference is set inline during account creation (in the payload).
        // We don't call source.link() separately because:
        // 1. For new accounts: source is already set at creation time
        // 2. For existing accounts: if they were created by this connector, source is already there;
        //    if they were created manually or by another integration, we can't/shouldn't override their source

        logOperation({
            operation,
            recordType: 'customer',
            recordId: customerId,
            bbxId: resultBbxId,
            status: 'success',
            duration: Date.now() - startTime
        });

        return resultBbxId;
    };

    /**
     * Sync a NetSuite Contact to a Billabex Contact using upsert.
     * The API matches existing contacts by email first, then by fuzzy name matching.
     * @param {number|string} contactId - NetSuite Contact internal ID
     * @returns {string} Billabex Contact UUID
     */
    const syncContact = (contactId) => {
        const startTime = Date.now();
        const { client } = getClientAndConnection();

        const contactRec = safeLoadRecord('contact', contactId);
        if (!contactRec) {
            log.debug({ title: 'sync.syncContact', details: `Contact ${contactId} could not be loaded, skipping` });
            return null;
        }

        // Get the parent customer
        const customerId = contactRec.getValue({ fieldId: 'company' });
        if (!customerId) {
            log.debug({ title: 'sync.syncContact', details: `Contact ${contactId} has no parent company, skipping` });
            return null;
        }

        // Ensure the parent customer is synced and get its Billabex Account ID
        const customerRec = safeLoadRecord('customer', customerId, { isDynamic: false });
        if (!customerRec) {
            log.debug({ title: 'sync.syncContact', details: `Parent customer ${customerId} for contact ${contactId} could not be loaded, skipping` });
            return null;
        }

        let bbxAccountId = customerRec.getValue({ fieldId: 'custentity_bbx_id' });
        if (!bbxAccountId) {
            bbxAccountId = syncAccount(customerId);
        }

        const firstName = contactRec.getValue({ fieldId: 'firstname' }) || '';
        const lastName = contactRec.getValue({ fieldId: 'lastname' }) || '';
        const email = contactRec.getValue({ fieldId: 'email' }) || null;
        const fullName = `${firstName} ${lastName}`.trim() || email;
        const title = contactRec.getValue({ fieldId: 'title' }) || null;

        // Use upsert - API matches by email first, then fuzzy name matching
        // If no match found, creates a new contact (requires fullName + language)
        const contactData = {
            fullName,
            language: DEFAULT_LANGUAGE,
            isPrimary: false,
            role: title
        };

        // Only include email if present (upsert uses it for matching)
        // resolveEmail() returns override email in sandbox mode
        const contactEmail = resolveEmail(email);
        if (contactEmail) {
            contactData.email = contactEmail;
        }

        const result = client.contacts.upsert(bbxAccountId, contactData);
        const resultBbxId = result.data.id;

        // Store the Billabex contact ID for traceability
        const existingBbxId = contactRec.getValue({ fieldId: 'custentity_bbx_contact_id' });
        if (existingBbxId !== resultBbxId) {
            record.submitFields({
                type: 'contact',
                id: contactId,
                values: { custentity_bbx_contact_id: resultBbxId },
                options: { enableSourcing: false, ignoreMandatoryFields: true }
            });
        }

        logOperation({
            operation: 'contacts.upsert',
            recordType: 'contact',
            recordId: contactId,
            bbxId: resultBbxId,
            status: 'success',
            duration: Date.now() - startTime
        });

        return resultBbxId;
    };

    /**
     * Sync customer email fields as contacts to Billabex using upsert.
     * Uses custentity_chorio_email_relance (primary for dunning) and email from the customer record.
     * Also removes orphan contacts from Billabex when emails are deleted from NetSuite.
     * @param {number|string} customerId - NetSuite Customer internal ID
     */
    const syncCustomerEmailContacts = (customerId) => {
        const { client } = getClientAndConnection();

        // Load customer record
        const customerRec = record.load({ type: 'customer', id: customerId, isDynamic: false });
        const bbxAccountId = customerRec.getValue({ fieldId: 'custentity_bbx_id' });

        if (!bbxAccountId) {
            log.debug({
                title: 'sync.syncCustomerEmailContacts',
                details: `Customer ${customerId} not synced to Billabex yet, skipping email contacts`
            });
            return;
        }

        // Get email fields from customer
        const relanceEmail = customerRec.getValue({ fieldId: 'custentity_chorio_email_relance' }) || '';
        const customerEmail = customerRec.getValue({ fieldId: 'email' }) || '';

        // Collect unique emails to sync (relance first as it's primary)
        const emailsToSync = [];
        if (relanceEmail && relanceEmail.trim()) {
            emailsToSync.push({ email: relanceEmail.trim(), isPrimary: true });
        }
        if (customerEmail && customerEmail.trim() && customerEmail.trim().toLowerCase() !== relanceEmail.trim().toLowerCase()) {
            emailsToSync.push({ email: customerEmail.trim(), isPrimary: !relanceEmail });
        }

        // Build set of all legitimate emails (from Customer + Contact records)
        // Used to determine which Billabex contacts are orphans and should be deleted
        const legitimateEmails = new Set();

        // Add customer emails (lowercase for comparison)
        for (const { email } of emailsToSync) {
            legitimateEmails.add(email.toLowerCase());
        }

        // Add emails from Contact records linked to this customer
        try {
            const contactResults = query.runSuiteQL({
                query: `SELECT email FROM contact WHERE company = ${customerId} AND email IS NOT NULL`
            }).results;

            for (const row of contactResults) {
                const contactEmail = row.asMap().email;
                if (contactEmail && contactEmail.trim()) {
                    legitimateEmails.add(contactEmail.trim().toLowerCase());
                }
            }
        } catch (e) {
            log.error({
                title: 'sync.syncCustomerEmailContacts',
                details: `Failed to query contact emails for customer ${customerId}: ${e.message}`
            });
        }

        // List existing Billabex contacts for this account and delete orphans
        try {
            const bbxContacts = client.contacts.list(bbxAccountId);
            const contactsData = bbxContacts.data || [];

            for (const bbxContact of contactsData) {
                const bbxEmail = bbxContact.email;
                if (!bbxEmail) continue; // Skip contacts without email

                const bbxEmailLower = bbxEmail.toLowerCase();

                // Check if this email is still legitimate
                // In sandbox mode, all emails become the same override email, so we compare using the override
                // But legitimateEmails contains real emails, so we need to handle sandbox mode specially
                const isLegitimate = legitimateEmails.has(bbxEmailLower);

                if (!isLegitimate) {
                    // This Billabex contact has an email that no longer exists in NetSuite - delete it
                    const startTime = Date.now();
                    try {
                        client.contacts.delete(bbxAccountId, bbxContact.id);
                        log.audit({
                            title: 'sync.syncCustomerEmailContacts',
                            details: `Deleted orphan contact ${bbxContact.id} (email: ${bbxEmail}) from Billabex`
                        });
                        logOperation({
                            operation: 'contacts.deleteOrphan',
                            recordType: 'customer',
                            recordId: customerId,
                            bbxId: bbxContact.id,
                            status: 'success',
                            message: `Deleted orphan contact with email: ${bbxEmail}`,
                            duration: Date.now() - startTime
                        });
                    } catch (deleteErr) {
                        log.error({
                            title: 'sync.syncCustomerEmailContacts',
                            details: `Failed to delete orphan contact ${bbxContact.id}: ${deleteErr.message}`
                        });
                        logOperation({
                            operation: 'contacts.deleteOrphan',
                            recordType: 'customer',
                            recordId: customerId,
                            bbxId: bbxContact.id,
                            status: 'error',
                            message: `Failed to delete orphan contact: ${deleteErr.message}`,
                            duration: Date.now() - startTime
                        });
                    }
                }
            }
        } catch (e) {
            log.error({
                title: 'sync.syncCustomerEmailContacts',
                details: `Failed to list Billabex contacts for account ${bbxAccountId}: ${e.message}`
            });
        }

        // If no emails to sync, we're done (orphans already deleted above)
        if (emailsToSync.length === 0) {
            log.debug({
                title: 'sync.syncCustomerEmailContacts',
                details: `Customer ${customerId} has no emails to sync`
            });
            return;
        }

        // Upsert each email - API handles deduplication via email matching
        // resolveEmail() returns override email in sandbox mode
        for (const { email, isPrimary } of emailsToSync) {
            const startTime = Date.now();
            const contactEmail = resolveEmail(email);

            try {
                const result = client.contacts.upsert(bbxAccountId, {
                    fullName: email,
                    email: contactEmail,
                    language: DEFAULT_LANGUAGE,
                    isPrimary: isPrimary
                });

                logOperation({
                    operation: 'contacts.upsertFromEmail',
                    recordType: 'customer',
                    recordId: customerId,
                    bbxId: result.data.id,
                    status: 'success',
                    message: `Upserted contact from email: ${email} (isPrimary: ${isPrimary})`,
                    duration: Date.now() - startTime
                });
            } catch (e) {
                log.error({
                    title: 'sync.syncCustomerEmailContacts',
                    details: `Failed to upsert contact for email ${email}: ${e.message}`
                });
                logOperation({
                    operation: 'contacts.upsertFromEmail',
                    recordType: 'customer',
                    recordId: customerId,
                    status: 'error',
                    message: `Failed to upsert contact for email ${email}: ${e.message}`,
                    duration: Date.now() - startTime
                });
            }
        }
    };

    /**
     * Sync a NetSuite Invoice to Billabex
     * @param {number|string} invoiceId - NetSuite Invoice internal ID
     * @returns {string} Billabex Invoice UUID
     */
    const syncInvoice = (invoiceId) => {
        const startTime = Date.now();
        const { client, connection } = getClientAndConnection();

        const invoiceRec = safeLoadRecord('invoice', invoiceId);
        if (!invoiceRec) {
            throw new Error(`Invoice ${invoiceId} could not be loaded (may have been deleted)`);
        }

        const bbxInvoiceId = invoiceRec.getValue({ fieldId: 'custbody_bbx_invoice_id' });

        // Get the customer and ensure it's synced
        const customerId = invoiceRec.getValue({ fieldId: 'entity' });
        if (!customerId) {
            throw new Error(`Invoice ${invoiceId} has no customer (entity field is empty)`);
        }

        const customerRec = safeLoadRecord('customer', customerId, { isDynamic: false });
        if (!customerRec) {
            throw new Error(`Customer ${customerId} for invoice ${invoiceId} could not be loaded`);
        }

        let bbxAccountId = customerRec.getValue({ fieldId: 'custentity_bbx_id' });
        if (!bbxAccountId) {
            bbxAccountId = syncAccount(customerId);
        }

        const tranId = invoiceRec.getValue({ fieldId: 'tranid' });
        const tranDate = invoiceRec.getValue({ fieldId: 'trandate' });
        const dueDate = invoiceRec.getValue({ fieldId: 'duedate' });
        const poNumber = invoiceRec.getValue({ fieldId: 'otherrefnum' }) || '';
        const total = parseFloat(invoiceRec.getValue({ fieldId: 'total' })) || 0;
        const taxTotal = parseFloat(invoiceRec.getValue({ fieldId: 'taxtotal' })) || 0;
        const amountRemaining = parseFloat(invoiceRec.getValue({ fieldId: 'amountremaining' })) || 0;
        const paidAmount = total - amountRemaining;

        let resultBbxId;
        let operation;
        let needsCreate = !bbxInvoiceId;
        let existingBbxInvoice = null;

        // If we have a bbxInvoiceId, try to get the existing invoice - but handle 404 (orphan reference)
        if (bbxInvoiceId) {
            try {
                existingBbxInvoice = client.invoices.get(bbxInvoiceId).data;
            } catch (e) {
                if (e.name === 'ApiError' && e.status === 404) {
                    // Invoice no longer exists in Billabex - clear the reference and create new
                    log.audit({
                        title: 'sync.syncInvoice',
                        details: `Invoice ${bbxInvoiceId} not found in Billabex (404), will create new`
                    });
                    record.submitFields({
                        type: 'invoice',
                        id: invoiceId,
                        values: { custbody_bbx_invoice_id: '' },
                        options: { enableSourcing: false, ignoreMandatoryFields: true }
                    });
                    needsCreate = true;
                } else {
                    throw e; // Re-throw other errors
                }
            }
        }

        // Check if existing invoice has changed
        if (existingBbxInvoice) {
            const hasChanged = invoiceHasChanged(existingBbxInvoice, { tranId, total, taxTotal, tranDate, dueDate, poNumber });

            if (hasChanged) {
                // Delete and recreate the invoice in Billabex
                operation = 'invoices.delete+create';
                try {
                    client.invoices.delete(bbxInvoiceId);
                } catch (e) {
                    // Ignore 404 on delete - invoice may have been deleted already
                    if (!(e.name === 'ApiError' && e.status === 404)) {
                        throw e;
                    }
                }
                needsCreate = true;
            } else if (existingBbxInvoice.paidAmount !== paidAmount) {
                // Only paid amount changed - use the dedicated endpoint
                operation = 'invoices.updatePaidAmount';
                client.invoices.updatePaidAmount(bbxInvoiceId, { paidAmount });
                resultBbxId = bbxInvoiceId;
            } else {
                // Nothing changed
                log.debug({ title: 'sync.syncInvoice', details: `Invoice ${invoiceId} unchanged, skipping` });
                return bbxInvoiceId;
            }
        }

        // Create new invoice if needed
        if (needsCreate) {
            if (!operation) operation = 'invoices.create';

            const pdfFile = render.transaction({
                entityId: parseInt(invoiceId, 10),
                printMode: render.PrintMode.PDF
            });
            const pdfContent = pdfFile.getContents();
            const pdfName = `${tranId}.pdf`;

            const billingAddress = {};
            try {
                const billAddrSubrec = invoiceRec.getSubrecord({ fieldId: 'billingaddress' });
                if (billAddrSubrec && typeof billAddrSubrec.getValue === 'function') {
                    billingAddress.street = billAddrSubrec.getValue({ fieldId: 'addr1' }) || null;
                    billingAddress.city = billAddrSubrec.getValue({ fieldId: 'city' }) || null;
                    billingAddress.postalCode = billAddrSubrec.getValue({ fieldId: 'zip' }) || null;
                    billingAddress.stateOrProvince = billAddrSubrec.getValue({ fieldId: 'state' }) || null;
                    billingAddress.country = billAddrSubrec.getValue({ fieldId: 'country' }) || null;
                }
            } catch (e) {
                log.debug({ title: 'sync.syncInvoice billingAddress', details: e.message });
            }

            const data = {
                accountId: bbxAccountId,
                number: tranId,
                poNumber,
                ...flattenDateForMultipart('issuedDate', toDateValue(tranDate)),
                ...flattenDateForMultipart('dueDate', toDateValue(dueDate)),
                totalAmount: total,
                taxAmount: taxTotal,
                paidAmount,
                'billingAddress[street]': billingAddress.street || '',
                'billingAddress[city]': billingAddress.city || '',
                'billingAddress[postalCode]': billingAddress.postalCode || '',
                'billingAddress[stateOrProvince]': billingAddress.stateOrProvince || '',
                'billingAddress[country]': billingAddress.country || ''
            };

            const result = client.invoices.create(data, pdfContent, pdfName);
            resultBbxId = result.data.id;

            record.submitFields({
                type: 'invoice',
                id: invoiceId,
                values: { custbody_bbx_invoice_id: resultBbxId },
                options: { enableSourcing: false, ignoreMandatoryFields: true }
            });
        }

        logOperation({
            operation,
            recordType: 'invoice',
            recordId: invoiceId,
            bbxId: resultBbxId,
            status: 'success',
            duration: Date.now() - startTime
        });

        return resultBbxId;
    };

    /**
     * Sync a NetSuite Credit Memo to a Billabex Credit Note
     * @param {number|string} creditMemoId - NetSuite Credit Memo internal ID
     * @returns {string} Billabex Credit Note UUID
     */
    const syncCreditMemo = (creditMemoId) => {
        const startTime = Date.now();
        const { client, connection } = getClientAndConnection();

        const cmRec = safeLoadRecord('creditmemo', creditMemoId);
        if (!cmRec) {
            throw new Error(`Credit memo ${creditMemoId} could not be loaded (may have been deleted)`);
        }

        let bbxCreditNoteId = cmRec.getValue({ fieldId: 'custbody_bbx_credit_memo_id' });

        // Get the customer and ensure it's synced
        const customerId = cmRec.getValue({ fieldId: 'entity' });
        if (!customerId) {
            throw new Error(`Credit memo ${creditMemoId} has no customer (entity field is empty)`);
        }

        const customerRec = safeLoadRecord('customer', customerId, { isDynamic: false });
        if (!customerRec) {
            throw new Error(`Customer ${customerId} for credit memo ${creditMemoId} could not be loaded`);
        }

        let bbxAccountId = customerRec.getValue({ fieldId: 'custentity_bbx_id' });
        if (!bbxAccountId) {
            bbxAccountId = syncAccount(customerId);
        }

        const tranId = cmRec.getValue({ fieldId: 'tranid' });
        const tranDate = cmRec.getValue({ fieldId: 'trandate' });
        const total = parseFloat(cmRec.getValue({ fieldId: 'total' })) || 0;
        const taxTotal = parseFloat(cmRec.getValue({ fieldId: 'taxtotal' })) || 0;

        let resultBbxId;
        let operation;
        let needsCreate = !bbxCreditNoteId;
        let existingBbxCreditNote = null;

        // If we have a bbxCreditNoteId, try to get the existing credit note - but handle 404 (orphan reference)
        if (bbxCreditNoteId) {
            try {
                existingBbxCreditNote = client.creditNotes.get(bbxCreditNoteId).data;
            } catch (e) {
                if (e.name === 'ApiError' && e.status === 404) {
                    // Credit note no longer exists in Billabex - clear the reference and create new
                    log.audit({
                        title: 'sync.syncCreditMemo',
                        details: `Credit note ${bbxCreditNoteId} not found in Billabex (404), will create new`
                    });
                    record.submitFields({
                        type: 'creditmemo',
                        id: creditMemoId,
                        values: { custbody_bbx_credit_memo_id: '' },
                        options: { enableSourcing: false, ignoreMandatoryFields: true }
                    });
                    needsCreate = true;
                } else {
                    throw e; // Re-throw other errors
                }
            }
        }

        // Check if existing credit note has changed
        if (existingBbxCreditNote) {
            const hasChanged = creditNoteHasChanged(existingBbxCreditNote, { tranId, total, taxTotal, tranDate });

            if (!hasChanged) {
                log.debug({ title: 'sync.syncCreditMemo', details: `Credit memo ${creditMemoId} unchanged, skipping` });
                return bbxCreditNoteId;
            }

            // Delete and recreate
            operation = 'creditNotes.delete+create';
            try {
                client.creditNotes.delete(bbxCreditNoteId);
            } catch (e) {
                // Ignore 404 on delete - credit note may have been deleted already
                if (!(e.name === 'ApiError' && e.status === 404)) {
                    throw e;
                }
            }
            needsCreate = true;
        }

        // Create new credit note if needed
        if (needsCreate) {
            if (!operation) operation = 'creditNotes.create';

            // Generate PDF
            const pdfFile = render.transaction({
                entityId: parseInt(creditMemoId, 10),
                printMode: render.PrintMode.PDF
            });
            const pdfContent = pdfFile.getContents();
            const pdfName = `${tranId}.pdf`;

            // Get billing address
            const billingAddress = {};
            try {
                const billAddrSubrec = cmRec.getSubrecord({ fieldId: 'billingaddress' });
                if (billAddrSubrec && typeof billAddrSubrec.getValue === 'function') {
                    billingAddress.street = billAddrSubrec.getValue({ fieldId: 'addr1' }) || null;
                    billingAddress.city = billAddrSubrec.getValue({ fieldId: 'city' }) || null;
                    billingAddress.postalCode = billAddrSubrec.getValue({ fieldId: 'zip' }) || null;
                    billingAddress.stateOrProvince = billAddrSubrec.getValue({ fieldId: 'state' }) || null;
                    billingAddress.country = billAddrSubrec.getValue({ fieldId: 'country' }) || null;
                }
            } catch (e) {
                log.debug({ title: 'sync.syncCreditMemo billingAddress', details: e.message });
            }

            const data = {
                accountId: bbxAccountId,
                number: tranId,
                ...flattenDateForMultipart('issuedDate', toDateValue(tranDate)),
                totalAmount: total,
                taxAmount: taxTotal,
                'billingAddress[street]': billingAddress.street || '',
                'billingAddress[city]': billingAddress.city || '',
                'billingAddress[postalCode]': billingAddress.postalCode || '',
                'billingAddress[stateOrProvince]': billingAddress.stateOrProvince || '',
                'billingAddress[country]': billingAddress.country || ''
            };

            const result = client.creditNotes.create(data, pdfContent, pdfName);
            resultBbxId = result.data.id;

            record.submitFields({
                type: 'creditmemo',
                id: creditMemoId,
                values: { custbody_bbx_credit_memo_id: resultBbxId },
                options: { enableSourcing: false, ignoreMandatoryFields: true }
            });
        }

        logOperation({
            operation,
            recordType: 'creditmemo',
            recordId: creditMemoId,
            bbxId: resultBbxId,
            status: 'success',
            duration: Date.now() - startTime
        });

        return resultBbxId;
    };

    /**
     * Sync credit allocations for a Credit Memo.
     * Reads the "apply" sublist on the Credit Memo to find which invoices
     * have been applied, and creates corresponding credit allocations in Billabex.
     * @param {number|string} creditMemoId - NetSuite Credit Memo internal ID
     */
    const syncCreditAllocations = (creditMemoId) => {
        const { client } = getClientAndConnection();

        const cmRec = record.load({ type: 'creditmemo', id: creditMemoId });
        const bbxCreditNoteId = cmRec.getValue({ fieldId: 'custbody_bbx_credit_memo_id' });

        if (!bbxCreditNoteId) {
            log.debug({
                title: 'sync.syncCreditAllocations',
                details: `Credit memo ${creditMemoId} not yet synced, skipping allocations`
            });
            return;
        }

        // Read the "apply" sublist to find applied invoices
        const applyCount = cmRec.getLineCount({ sublistId: 'apply' });

        for (let i = 0; i < applyCount; i++) {
            const isApplied = cmRec.getSublistValue({
                sublistId: 'apply', fieldId: 'apply', line: i
            });

            if (!isApplied) continue;

            const startTime = Date.now();
            const appliedAmount = parseFloat(cmRec.getSublistValue({
                sublistId: 'apply', fieldId: 'amount', line: i
            })) || 0;

            if (appliedAmount <= 0) continue;

            const appliedInvoiceId = cmRec.getSublistValue({
                sublistId: 'apply', fieldId: 'internalid', line: i
            });

            // Get the Billabex Invoice ID
            let bbxInvoiceId;
            try {
                const invoiceResults = query.runSuiteQL({
                    query: `SELECT custbody_bbx_invoice_id FROM transaction WHERE id = ${appliedInvoiceId}`
                }).results;
                if (invoiceResults.length > 0) {
                    bbxInvoiceId = invoiceResults[0].asMap().custbody_bbx_invoice_id;
                }
            } catch (e) {
                log.debug({ title: 'sync.syncCreditAllocations invoice lookup', details: e.message });
            }

            if (!bbxInvoiceId) {
                log.debug({
                    title: 'sync.syncCreditAllocations',
                    details: `Invoice ${appliedInvoiceId} not yet synced, skipping allocation`
                });
                continue;
            }

            try {
                client.creditAllocations.apply({
                    creditNoteId: bbxCreditNoteId,
                    invoiceId: bbxInvoiceId,
                    amount: appliedAmount
                });

                logOperation({
                    operation: 'creditAllocations.apply',
                    recordType: 'creditmemo',
                    recordId: creditMemoId,
                    bbxId: bbxCreditNoteId,
                    status: 'success',
                    message: `Allocated ${appliedAmount} to invoice ${bbxInvoiceId}`,
                    duration: Date.now() - startTime
                });
            } catch (e) {
                // 400 may mean allocation already exists, log and continue
                logOperation({
                    operation: 'creditAllocations.apply',
                    recordType: 'creditmemo',
                    recordId: creditMemoId,
                    bbxId: bbxCreditNoteId,
                    status: 'error',
                    message: `Failed to allocate ${appliedAmount} to invoice ${bbxInvoiceId}: ${e.message}`,
                    duration: Date.now() - startTime
                });
            }
        }
    };

    /**
     * Sync a Customer Payment - updates paidAmount on all applied invoices
     * @param {number|string} paymentId - NetSuite Customer Payment internal ID
     */
    const syncPayment = (paymentId) => {
        const { client } = getClientAndConnection();

        const paymentRec = record.load({ type: 'customerpayment', id: paymentId });
        const applyCount = paymentRec.getLineCount({ sublistId: 'apply' });

        for (let i = 0; i < applyCount; i++) {
            const isApplied = paymentRec.getSublistValue({
                sublistId: 'apply', fieldId: 'apply', line: i
            });

            if (!isApplied) continue;

            const startTime = Date.now();
            const appliedInvoiceId = paymentRec.getSublistValue({
                sublistId: 'apply', fieldId: 'internalid', line: i
            });

            // Load the invoice to get the current paid amount and Billabex ID
            let bbxInvoiceId, total, amountRemaining;
            try {
                const invResults = query.runSuiteQL({
                    query: `SELECT
                        t.custbody_bbx_invoice_id,
                        t.foreigntotal AS total,
                        t.foreignamountremaining AS amountremaining
                    FROM transaction t
                    WHERE t.id = ${appliedInvoiceId}`
                }).results;

                if (invResults.length > 0) {
                    const inv = invResults[0].asMap();
                    bbxInvoiceId = inv.custbody_bbx_invoice_id;
                    total = parseFloat(inv.total) || 0;
                    amountRemaining = parseFloat(inv.amountremaining) || 0;
                }
            } catch (e) {
                log.debug({ title: 'sync.syncPayment invoice lookup', details: e.message });
                continue;
            }

            if (!bbxInvoiceId) {
                log.debug({
                    title: 'sync.syncPayment',
                    details: `Invoice ${appliedInvoiceId} not yet synced to Billabex, skipping`
                });
                continue;
            }

            const paidAmount = total - amountRemaining;

            try {
                client.invoices.updatePaidAmount(bbxInvoiceId, { paidAmount });

                logOperation({
                    operation: 'invoices.updatePaidAmount',
                    recordType: 'customerpayment',
                    recordId: paymentId,
                    bbxId: bbxInvoiceId,
                    status: 'success',
                    message: `Updated paid amount to ${paidAmount} for invoice ${appliedInvoiceId}`,
                    duration: Date.now() - startTime
                });
            } catch (e) {
                // Handle 404 - invoice no longer exists in Billabex, re-sync it
                if (e.name === 'ApiError' && e.status === 404) {
                    log.audit({
                        title: 'sync.syncPayment',
                        details: `Invoice ${bbxInvoiceId} not found in Billabex (404), re-syncing invoice ${appliedInvoiceId}`
                    });
                    try {
                        // Re-sync the invoice - this will clear the orphan bbxId and create a new one
                        const newBbxInvoiceId = syncInvoice(appliedInvoiceId);
                        logOperation({
                            operation: 'invoices.resyncAfter404',
                            recordType: 'customerpayment',
                            recordId: paymentId,
                            bbxId: newBbxInvoiceId,
                            status: 'success',
                            message: `Re-synced invoice ${appliedInvoiceId} after 404, new BBX ID: ${newBbxInvoiceId}`,
                            duration: Date.now() - startTime
                        });
                    } catch (resyncErr) {
                        logOperation({
                            operation: 'invoices.resyncAfter404',
                            recordType: 'customerpayment',
                            recordId: paymentId,
                            status: 'error',
                            message: `Failed to re-sync invoice ${appliedInvoiceId}: ${resyncErr.message}`,
                            duration: Date.now() - startTime
                        });
                    }
                } else {
                    logOperation({
                        operation: 'invoices.updatePaidAmount',
                        recordType: 'customerpayment',
                        recordId: paymentId,
                        bbxId: bbxInvoiceId,
                        status: 'error',
                        message: `Failed to update paid amount for invoice ${appliedInvoiceId}: ${e.message}`,
                        duration: Date.now() - startTime
                    });
                }
            }
        }
    };

    /**
     * Full sync for a customer: account + contacts + unpaid invoices + relevant credit memos + allocations
     * Used by the MapReduce full sync and queue processor
     * @param {number|string} customerId - NetSuite Customer internal ID
     */
    const syncFullAccount = (customerId) => {
        // 1. Sync the account
        const bbxAccountId = syncAccount(customerId);

        // 2. Sync contacts linked to this customer
        try {
            const contactResults = query.runSuiteQL({
                query: `SELECT id FROM contact WHERE company = ${customerId}`
            }).results || [];

            for (const row of contactResults) {
                const rowData = row.asMap();
                if (!rowData || !rowData.id) {
                    log.debug({ title: 'sync.syncFullAccount', details: `Skipping contact with null/invalid data` });
                    continue;
                }
                const contactId = rowData.id;
                try {
                    syncContact(contactId);
                } catch (e) {
                    log.error({
                        title: 'sync.syncFullAccount contact error',
                        details: `Contact ${contactId}: ${e.message}`
                    });
                    logOperation({
                        operation: 'contacts.sync',
                        recordType: 'contact',
                        recordId: contactId,
                        status: 'error',
                        message: e.message
                    });
                }
            }
        } catch (e) {
            log.error({ title: 'sync.syncFullAccount contacts query', details: e.message });
        }

        // 2b. Sync email-based contacts from customer fields
        try {
            syncCustomerEmailContacts(customerId);
        } catch (e) {
            log.error({
                title: 'sync.syncFullAccount email contacts error',
                details: `Customer ${customerId}: ${e.message}`
            });
        }

        // 3. Sync unpaid invoices (status = Open, includes partially paid)
        try {
            const invoiceResults = query.runSuiteQL({
                query: `SELECT t.id FROM transaction t
                    WHERE t.entity = ${customerId}
                      AND t.type = 'CustInvc'
                      AND BUILTIN.CF(t.status) = 'CustInvc:A'`
            }).results || [];

            for (const row of invoiceResults) {
                const rowData = row.asMap();
                if (!rowData || !rowData.id) {
                    log.debug({ title: 'sync.syncFullAccount', details: `Skipping invoice with null/invalid data` });
                    continue;
                }
                const invoiceId = rowData.id;
                try {
                    syncInvoice(invoiceId);
                } catch (e) {
                    log.error({
                        title: 'sync.syncFullAccount invoice error',
                        details: `Invoice ${invoiceId}: ${e.message}`
                    });
                    logOperation({
                        operation: 'invoices.sync',
                        recordType: 'invoice',
                        recordId: invoiceId,
                        status: 'error',
                        message: e.message
                    });
                }
            }
        } catch (e) {
            log.error({ title: 'sync.syncFullAccount invoices query', details: e.message });
        }

        // 4. Sync credit memos:
        //    - Open credit memos (not yet applied or partially applied)
        //    - Fully applied credit memos that are linked to still-unpaid invoices
        try {
            const cmResults = query.runSuiteQL({
                query: `SELECT t.id FROM transaction t
                    WHERE t.entity = ${customerId}
                      AND t.type = 'CustCred'
                      AND BUILTIN.CF(t.status) = 'CustCred:A'

                    UNION

                    SELECT DISTINCT NTLL.PreviousDoc AS id
                    FROM NextTransactionLineLink NTLL
                    INNER JOIN Transaction cm ON cm.id = NTLL.PreviousDoc
                    INNER JOIN Transaction inv ON inv.id = NTLL.NextDoc
                    WHERE cm.entity = ${customerId}
                      AND cm.type = 'CustCred'
                      AND BUILTIN.CF(cm.status) = 'CustCred:B'
                      AND inv.type = 'CustInvc'
                      AND BUILTIN.CF(inv.status) = 'CustInvc:A'
                      AND NTLL.LinkType = 'Payment'`
            }).results || [];

            // Build list of valid credit memo IDs
            const cmIds = [];
            for (const row of cmResults) {
                const rowData = row.asMap();
                if (rowData && rowData.id) {
                    cmIds.push(rowData.id);
                }
            }

            for (const cmId of cmIds) {
                try {
                    syncCreditMemo(cmId);
                } catch (e) {
                    log.error({
                        title: 'sync.syncFullAccount creditmemo error',
                        details: `Credit Memo ${cmId}: ${e.message}`
                    });
                    logOperation({
                        operation: 'creditNotes.sync',
                        recordType: 'creditmemo',
                        recordId: cmId,
                        status: 'error',
                        message: e.message
                    });
                }
            }

            // 5. Sync credit allocations for each credit memo
            for (const cmId of cmIds) {
                try {
                    syncCreditAllocations(cmId);
                } catch (e) {
                    log.error({
                        title: 'sync.syncFullAccount credit allocation error',
                        details: `Credit Memo allocations ${cmId}: ${e.message}`
                    });
                }
            }
        } catch (e) {
            log.error({ title: 'sync.syncFullAccount credit memos query', details: e.message });
        }

        return bbxAccountId;
    };

    // ═══════════════════════════════════════════════════════════════════════
    // DELETE FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Delete a Billabex Account.
     * This cascades and deletes all associated contacts, invoices, credit notes, etc.
     * @param {string} bbxAccountId - Billabex Account UUID
     */
    const deleteAccount = (bbxAccountId) => {
        if (!bbxAccountId) {
            log.debug({ title: 'sync.deleteAccount', details: 'No Billabex Account ID provided, skipping' });
            return;
        }

        const startTime = Date.now();
        const { client } = getClientAndConnection();

        try {
            client.accounts.delete(bbxAccountId);
            logOperation({
                operation: 'accounts.delete',
                recordType: 'customer',
                recordId: 'deleted',
                bbxId: bbxAccountId,
                status: 'success',
                message: 'Account deleted from Billabex (cascades contacts, invoices, etc.)',
                duration: Date.now() - startTime
            });
        } catch (e) {
            // 404 means already deleted, which is fine
            if (e.message && e.message.includes('404')) {
                log.debug({
                    title: 'sync.deleteAccount',
                    details: `Account ${bbxAccountId} already deleted or not found in Billabex`
                });
                return;
            }
            throw e;
        }
    };

    /**
     * Delete a Billabex Contact.
     * @param {string} bbxAccountId - Billabex Account UUID
     * @param {string} bbxContactId - Billabex Contact UUID
     */
    const deleteContact = (bbxAccountId, bbxContactId) => {
        if (!bbxAccountId || !bbxContactId) {
            log.debug({
                title: 'sync.deleteContact',
                details: `Missing IDs: accountId=${bbxAccountId}, contactId=${bbxContactId}, skipping`
            });
            return;
        }

        const startTime = Date.now();
        const { client } = getClientAndConnection();

        try {
            client.contacts.delete(bbxAccountId, bbxContactId);
            logOperation({
                operation: 'contacts.delete',
                recordType: 'contact',
                recordId: 'deleted',
                bbxId: bbxContactId,
                status: 'success',
                message: 'Contact deleted from Billabex',
                duration: Date.now() - startTime
            });
        } catch (e) {
            // 404 means already deleted, which is fine
            if (e.message && e.message.includes('404')) {
                log.debug({
                    title: 'sync.deleteContact',
                    details: `Contact ${bbxContactId} already deleted or not found in Billabex`
                });
                return;
            }
            throw e;
        }
    };

    /**
     * Delete a Billabex Invoice.
     * @param {string} bbxInvoiceId - Billabex Invoice UUID
     */
    const deleteInvoice = (bbxInvoiceId) => {
        if (!bbxInvoiceId) {
            log.debug({ title: 'sync.deleteInvoice', details: 'No Billabex Invoice ID provided, skipping' });
            return;
        }

        const startTime = Date.now();
        const { client } = getClientAndConnection();

        try {
            client.invoices.delete(bbxInvoiceId);
            logOperation({
                operation: 'invoices.delete',
                recordType: 'invoice',
                recordId: 'deleted',
                bbxId: bbxInvoiceId,
                status: 'success',
                message: 'Invoice deleted from Billabex',
                duration: Date.now() - startTime
            });
        } catch (e) {
            // 404 means already deleted, which is fine
            if (e.message && e.message.includes('404')) {
                log.debug({
                    title: 'sync.deleteInvoice',
                    details: `Invoice ${bbxInvoiceId} already deleted or not found in Billabex`
                });
                return;
            }
            throw e;
        }
    };

    /**
     * Delete a Billabex Credit Note.
     * @param {string} bbxCreditNoteId - Billabex Credit Note UUID
     */
    const deleteCreditMemo = (bbxCreditNoteId) => {
        if (!bbxCreditNoteId) {
            log.debug({ title: 'sync.deleteCreditMemo', details: 'No Billabex Credit Note ID provided, skipping' });
            return;
        }

        const startTime = Date.now();
        const { client } = getClientAndConnection();

        try {
            client.creditNotes.delete(bbxCreditNoteId);
            logOperation({
                operation: 'creditNotes.delete',
                recordType: 'creditmemo',
                recordId: 'deleted',
                bbxId: bbxCreditNoteId,
                status: 'success',
                message: 'Credit note deleted from Billabex',
                duration: Date.now() - startTime
            });
        } catch (e) {
            // 404 means already deleted, which is fine
            if (e.message && e.message.includes('404')) {
                log.debug({
                    title: 'sync.deleteCreditMemo',
                    details: `Credit note ${bbxCreditNoteId} already deleted or not found in Billabex`
                });
                return;
            }
            throw e;
        }
    };

    /**
     * Enqueue a delete operation for retry.
     * For delete operations, we store the Billabex ID (not the NetSuite ID)
     * since the NetSuite record no longer exists.
     * @param {string} recordType - NetSuite record type
     * @param {string} bbxId - Billabex UUID to delete
     * @param {string} [bbxAccountId] - For contacts, the parent account UUID
     */
    const enqueueDelete = (recordType, bbxId, bbxAccountId) => {
        try {
            // For deletes, we store bbxId in record_id field since NS record is gone
            // For contacts, we need both account and contact ID, stored as JSON
            const recordIdValue = recordType === 'contact'
                ? JSON.stringify({ accountId: bbxAccountId, contactId: bbxId })
                : bbxId;

            const queueRec = record.create({ type: 'customrecord_bbx_sync_queue' });
            queueRec.setValue({ fieldId: 'name', value: `DELETE ${recordType}:${bbxId}` });
            queueRec.setValue({ fieldId: 'custrecord_bbx_sq_record_type', value: recordType });
            queueRec.setValue({ fieldId: 'custrecord_bbx_sq_record_id', value: recordIdValue });
            queueRec.setValue({ fieldId: 'custrecord_bbx_sq_action', value: 'delete' });
            queueRec.setValue({ fieldId: 'custrecord_bbx_sq_status', value: 'pending' });
            queueRec.setValue({ fieldId: 'custrecord_bbx_sq_retry_count', value: 0 });
            queueRec.save();
        } catch (e) {
            log.error({ title: 'sync.enqueueDelete failed', details: e.message });
        }
    };

    // ═══════════════════════════════════════════════════════════════════════
    // MODULE EXPORTS
    // ═══════════════════════════════════════════════════════════════════════

    return {
        syncAccount,
        syncContact,
        syncCustomerEmailContacts,
        syncInvoice,
        syncCreditMemo,
        syncCreditAllocations,
        syncPayment,
        syncFullAccount,
        enqueueSync,
        enqueueDelete,
        deleteAccount,
        deleteContact,
        deleteInvoice,
        deleteCreditMemo,
        logOperation
    };
});
