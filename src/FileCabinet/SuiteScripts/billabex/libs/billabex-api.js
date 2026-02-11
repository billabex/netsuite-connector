/**
 * billabex-api.js
 * Billabex Public API Client for NetSuite
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */

// ═══════════════════════════════════════════════════════════════════════════
// MODULE-LEVEL CONFIG (set by define() callback)
// ═══════════════════════════════════════════════════════════════════════════

let API_BASE_URL = null;

// ═══════════════════════════════════════════════════════════════════════════
// CUSTOM ERROR CLASSES
// ═══════════════════════════════════════════════════════════════════════════

class TokenExpiredError extends Error {
    constructor(message = 'Access token expired') {
        super(message);
        this.name = 'TokenExpiredError';
    }
}

class RateLimitError extends Error {
    constructor(retryAfter, message = 'Rate limit exceeded') {
        super(message);
        this.name = 'RateLimitError';
        this.retryAfter = retryAfter;
    }
}

class ApiError extends Error {
    constructor(status, message, body = null) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.body = body;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// BILLABEX API CLIENT
// ═══════════════════════════════════════════════════════════════════════════

class BillabexApiClient {
    #connection;
    #connectionName;
    #https;
    #log;
    #getConnection;

    constructor(connectionName, https, log, getConnection) {
        this.#connectionName = connectionName;
        this.#https = https;
        this.#log = log;
        this.#getConnection = getConnection;
        this.#connection = getConnection(connectionName);

        if (!this.#connection.isConnected()) {
            throw new Error(`Connection '${connectionName}' is not connected`);
        }
    }

    // ───────────────────────────────────────────────────────────────────────
    // CASE-INSENSITIVE HEADER LOOKUP
    // ───────────────────────────────────────────────────────────────────────

    /**
     * Get a response header value with case-insensitive lookup.
     * NetSuite's N/https module may return headers in lowercase.
     * @param {Object} headers - Response headers object
     * @param {string} name - Header name to look up
     * @returns {string|null} Header value or null if not found
     */
    #getHeader(headers, name) {
        if (!headers) return null;
        // Try exact match first
        if (headers[name] !== undefined) return headers[name];
        // Try lowercase match
        const lowerName = name.toLowerCase();
        for (const key of Object.keys(headers)) {
            if (key.toLowerCase() === lowerName) {
                return headers[key];
            }
        }
        return null;
    }

    // ───────────────────────────────────────────────────────────────────────
    // INTERNAL HTTP REQUEST METHOD
    // ───────────────────────────────────────────────────────────────────────

    #request(method, path, { body = null, query = {}, maxRetries = 3, _isRetryAfter401 = false } = {}) {
        // Check token validity before making request
        if (!this.#connection.isAccessTokenValid()) {
            // Token may have been refreshed by the scheduled script - reload from DB
            this.#connection = this.#getConnection(this.#connectionName);

            if (!this.#connection.isAccessTokenValid()) {
                // Still expired after reload - truly expired
                throw new TokenExpiredError(
                    `Access token for '${this.#connectionName}' has expired. ` +
                    'Wait for the scheduled refresh or trigger it manually.'
                );
            }
        }

        // Build URL with query params
        let url = `${API_BASE_URL}${path}`;
        const queryString = Object.entries(query)
            .filter(([, v]) => v !== undefined && v !== null)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
            .join('&');
        if (queryString) {
            url += `?${queryString}`;
        }

        const headers = {
            'Authorization': `Bearer ${this.#connection.oauthAccessToken}`,
            'Accept': 'application/json'
        };

        if (body && !(body instanceof Object && body._isMultipart)) {
            headers['Content-Type'] = 'application/json';
        }

        let attempt = 0;

        while (attempt <= maxRetries) {
            const options = { url, headers };

            if (body) {
                if (body._isMultipart) {
                    options.body = body.data;
                    headers['Content-Type'] = body.contentType;
                } else {
                    options.body = JSON.stringify(body);
                }
            }

            let response;
            switch (method) {
                case 'GET':
                    response = this.#https.get(options);
                    break;
                case 'POST':
                    response = this.#https.post(options);
                    break;
                case 'PUT':
                    response = this.#https.put(options);
                    break;
                case 'DELETE':
                    response = this.#https.delete(options);
                    break;
                default:
                    throw new Error(`Unsupported HTTP method: ${method}`);
            }

            // Extract rate limit headers (case-insensitive)
            const rateLimit = {
                limit: parseInt(this.#getHeader(response.headers, 'X-RateLimit-Limit'), 10) || null,
                remaining: parseInt(this.#getHeader(response.headers, 'X-RateLimit-Remaining'), 10) || null,
                reset: parseInt(this.#getHeader(response.headers, 'X-RateLimit-Reset'), 10) || null
            };

            this.#log.debug('BillabexApiClient.request', {
                method,
                path,
                status: response.code,
                rateLimitRemaining: rateLimit.remaining
            });

            // Handle rate limiting (429)
            if (response.code === 429) {
                const retryAfter = parseInt(this.#getHeader(response.headers, 'Retry-After'), 10) || 60;

                if (attempt >= maxRetries) {
                    throw new RateLimitError(
                        retryAfter,
                        `Rate limit exceeded after ${maxRetries} retries. Retry after ${retryAfter}s`
                    );
                }

                // Wait before retrying (busy wait - NetSuite has no native sleep)
                const waitMs = Math.max(1000, retryAfter * 1000);
                const waitUntil = Date.now() + waitMs;
                while (Date.now() < waitUntil) {
                    // Busy wait
                }

                attempt++;
                continue;
            }

            // Handle token rejection (401) - try reloading connection once
            if (response.code === 401) {
                if (!_isRetryAfter401) {
                    // Reload connection from DB in case token was refreshed
                    this.#connection = this.#getConnection(this.#connectionName);

                    if (this.#connection.isAccessTokenValid()) {
                        // Retry the request with the new token
                        return this.#request(method, path, { body, query, maxRetries, _isRetryAfter401: true });
                    }
                }
                throw new TokenExpiredError('Server rejected the access token');
            }

            // Handle client/server errors (4xx/5xx)
            if (response.code >= 400) {
                let errorBody = null;
                let errorMessage = `API Error ${response.code}`;

                try {
                    errorBody = JSON.parse(response.body || '{}');
                    errorMessage = errorBody.message || errorMessage;
                } catch (e) {
                    // Ignore parse errors
                }

                throw new ApiError(response.code, errorMessage, errorBody);
            }

            // Success - parse response
            let data = null;
            if (response.body && response.code !== 204) {
                try {
                    data = JSON.parse(response.body);
                } catch (e) {
                    data = response.body;
                }
            }

            return { data, rateLimit };
        }

        throw new Error('Request failed after max retries');
    }

    // ───────────────────────────────────────────────────────────────────────
    // MULTIPART FORM-DATA BUILDER
    // ───────────────────────────────────────────────────────────────────────

    #buildMultipartBody(boundary, data, fileContent, fileName) {
        let body = '';

        // Add data fields
        for (const [key, value] of Object.entries(data)) {
            if (value !== undefined && value !== null) {
                body += `--${boundary}\r\n`;
                body += `Content-Disposition: form-data; name="${key}"\r\n\r\n`;
                body += `${value}\r\n`;
            }
        }

        // Add file
        if (fileContent && fileName) {
            const mimeType = fileName.toLowerCase().endsWith('.pdf')
                ? 'application/pdf'
                : 'image/png';
            body += `--${boundary}\r\n`;
            body += `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`;
            body += `Content-Type: ${mimeType}\r\n`;
            body += `Content-Transfer-Encoding: base64\r\n\r\n`;
            body += fileContent;
            body += '\r\n';
        }

        body += `--${boundary}--\r\n`;
        return body;
    }

    // ───────────────────────────────────────────────────────────────────────
    // ORGANIZATIONS (read-only)
    // ───────────────────────────────────────────────────────────────────────

    get organizations() {
        const self = this;
        return {
            /**
             * List organizations the authenticated user belongs to
             * @param {Object} params - Pagination parameters
             * @param {number} [params.first] - Number of items to return
             * @param {string} [params.after] - Cursor for pagination
             * @returns {{ data: { nodes: Array, pageInfo: { endCursor: string } }, rateLimit: Object }}
             */
            list({ first, after } = {}) {
                return self.#request('GET', '/organizations', {
                    query: { first, after }
                });
            },

            /**
             * Get a specific organization by ID
             * @param {string} organizationId - UUID of the organization
             * @returns {{ data: Object, rateLimit: Object }}
             */
            get(organizationId) {
                return self.#request('GET', `/organizations/${organizationId}`);
            }
        };
    }

    // ───────────────────────────────────────────────────────────────────────
    // ACCOUNTS
    // ───────────────────────────────────────────────────────────────────────

    get accounts() {
        const self = this;
        return {
            /**
             * List accounts for an organization
             * @param {Object} params - Query parameters
             * @param {string} params.organizationId - UUID of the organization (required)
             * @param {number} [params.first] - Number of items to return
             * @param {string} [params.after] - Cursor for pagination
             * @returns {{ data: { nodes: Array, pageInfo: { endCursor: string } }, rateLimit: Object }}
             */
            list({ organizationId, first, after }) {
                return self.#request('GET', '/accounts', {
                    query: { organizationId, first, after }
                });
            },

            /**
             * Get a specific account by ID
             * @param {string} accountId - UUID of the account
             * @returns {{ data: Object, rateLimit: Object }}
             */
            get(accountId) {
                return self.#request('GET', `/accounts/${accountId}`);
            },

            /**
             * Create a new account
             * @param {Object} data - Account data
             * @param {string} data.organizationId - UUID of the organization
             * @param {string} data.fullName - Full name of the account
             * @param {Object} data.currency - Currency object with code property
             * @param {Object} [data.billingAddress] - Billing address
             * @returns {{ data: Object, rateLimit: Object }}
             */
            create(data) {
                return self.#request('POST', '/accounts', { body: data });
            },

            /**
             * Update an existing account
             * @param {string} accountId - UUID of the account
             * @param {Object} data - Account data to update
             * @returns {{ data: Object, rateLimit: Object }}
             */
            update(accountId, data) {
                return self.#request('PUT', `/accounts/${accountId}`, { body: data });
            },

            /**
             * Delete an account
             * @param {string} accountId - UUID of the account
             * @returns {{ data: null, rateLimit: Object }}
             */
            delete(accountId) {
                return self.#request('DELETE', `/accounts/${accountId}`);
            }
        };
    }

    // ───────────────────────────────────────────────────────────────────────
    // SOURCE
    // ───────────────────────────────────────────────────────────────────────

    /**
     * Source management for accounts.
     * Links accounts to external systems for traceability.
     */
    get source() {
        const self = this;
        return {
            /**
             * Link a source to an account.
             * Creates or updates the source reference.
             * @param {string} accountId - UUID of the account
             * @param {Object} data - Source reference data
             * @param {string} data.connectionId - Identifier for the integration (e.g., 'netsuite-connector')
             * @param {string} data.sourceId - External system ID (e.g., NetSuite internal ID)
             * @returns {{ data: Object, rateLimit: Object }} - Updated account with source
             */
            link(accountId, data) {
                return self.#request('PUT', `/accounts/${accountId}/source`, { body: data });
            },

            /**
             * Unlink a source from an account.
             * Only works for accounts with Custom source type.
             * @param {string} accountId - UUID of the account
             * @returns {{ data: null, rateLimit: Object }}
             */
            unlink(accountId) {
                return self.#request('DELETE', `/accounts/${accountId}/source`);
            }
        };
    }

    // ───────────────────────────────────────────────────────────────────────
    // CONTACTS
    // ───────────────────────────────────────────────────────────────────────

    get contacts() {
        const self = this;
        return {
            /**
             * List contacts for an account
             * @param {string} accountId - UUID of the account
             * @returns {{ data: Array, rateLimit: Object }}
             */
            list(accountId) {
                return self.#request('GET', `/accounts/${accountId}/contacts`);
            },

            /**
             * Get a specific contact
             * @param {string} accountId - UUID of the account
             * @param {string} contactId - UUID of the contact
             * @returns {{ data: Object, rateLimit: Object }}
             */
            get(accountId, contactId) {
                return self.#request('GET', `/accounts/${accountId}/contacts/${contactId}`);
            },

            /**
             * Create a new contact for an account
             * @param {string} accountId - UUID of the account
             * @param {Object} data - Contact data
             * @param {string} data.fullName - Full name of the contact
             * @param {string} [data.email] - Email address
             * @param {string} [data.language] - Language code (e.g., 'fr', 'en')
             * @param {boolean} [data.isPrimary] - Whether this is the primary contact
             * @param {string} [data.role] - Role or job title
             * @param {string} [data.notes] - Additional notes
             * @returns {{ data: Object, rateLimit: Object }}
             */
            create(accountId, data) {
                return self.#request('POST', `/accounts/${accountId}/contacts`, { body: data });
            },

            /**
             * Update an existing contact
             * @param {string} accountId - UUID of the account
             * @param {string} contactId - UUID of the contact
             * @param {Object} data - Contact data to update
             * @returns {{ data: Object, rateLimit: Object }}
             */
            update(accountId, contactId, data) {
                return self.#request('PUT', `/accounts/${accountId}/contacts/${contactId}`, { body: data });
            },

            /**
             * Delete a contact
             * @param {string} accountId - UUID of the account
             * @param {string} contactId - UUID of the contact
             * @returns {{ data: null, rateLimit: Object }}
             */
            delete(accountId, contactId) {
                return self.#request('DELETE', `/accounts/${accountId}/contacts/${contactId}`);
            },

            /**
             * Upsert a contact (create or update based on email/name matching)
             * @param {string} accountId - UUID of the account
             * @param {Object} data - Contact data
             * @param {string} data.fullName - Full name (required for create)
             * @param {string} [data.email] - Email address (used for matching)
             * @param {string} data.language - Language code (required for create, e.g., 'fr', 'en')
             * @param {boolean} [data.isPrimary] - Whether this is the primary contact
             * @param {string} [data.role] - Role or job title
             * @param {string} [data.notes] - Additional notes
             * @returns {{ data: Object, rateLimit: Object }}
             */
            upsert(accountId, data) {
                return self.#request('PUT', `/accounts/${accountId}/contacts/upsert`, { body: data });
            }
        };
    }

    // ───────────────────────────────────────────────────────────────────────
    // INTERNAL REPRESENTATIVES
    // ───────────────────────────────────────────────────────────────────────

    get internalRepresentatives() {
        const self = this;
        return {
            /**
             * List internal representatives for an account
             * @param {string} accountId - UUID of the account
             * @returns {{ data: Array, rateLimit: Object }}
             */
            list(accountId) {
                return self.#request('GET', `/accounts/${accountId}/internal-representatives`);
            },

            /**
             * Get a specific internal representative
             * @param {string} accountId - UUID of the account
             * @param {string} representativeId - UUID of the internal representative
             * @returns {{ data: Object, rateLimit: Object }}
             */
            get(accountId, representativeId) {
                return self.#request('GET', `/accounts/${accountId}/internal-representatives/${representativeId}`);
            },

            /**
             * Create a new internal representative for an account
             * @param {string} accountId - UUID of the account
             * @param {Object} data - Representative data
             * @param {string} data.fullName - Full name
             * @param {string} [data.email] - Email address
             * @param {string} [data.language] - Language code (e.g., 'fr', 'en')
             * @param {boolean} [data.isPrimary] - Whether this is the primary representative
             * @param {string} [data.role] - Role or job title
             * @param {string} [data.notes] - Additional notes
             * @returns {{ data: Object, rateLimit: Object }}
             */
            create(accountId, data) {
                return self.#request('POST', `/accounts/${accountId}/internal-representatives`, { body: data });
            },

            /**
             * Update an existing internal representative
             * @param {string} accountId - UUID of the account
             * @param {string} representativeId - UUID of the internal representative
             * @param {Object} data - Representative data to update
             * @returns {{ data: Object, rateLimit: Object }}
             */
            update(accountId, representativeId, data) {
                return self.#request('PUT', `/accounts/${accountId}/internal-representatives/${representativeId}`, { body: data });
            },

            /**
             * Delete an internal representative
             * @param {string} accountId - UUID of the account
             * @param {string} representativeId - UUID of the internal representative
             * @returns {{ data: null, rateLimit: Object }}
             */
            delete(accountId, representativeId) {
                return self.#request('DELETE', `/accounts/${accountId}/internal-representatives/${representativeId}`);
            },

            /**
             * Upsert an internal representative (create or update based on email/name matching)
             * @param {string} accountId - UUID of the account
             * @param {Object} data - Representative data
             * @param {string} data.fullName - Full name (required for create)
             * @param {string} [data.email] - Email address (used for matching)
             * @param {string} data.language - Language code (required for create, e.g., 'fr', 'en')
             * @param {boolean} [data.isPrimary] - Whether this is the primary representative
             * @param {string} [data.role] - Role or job title
             * @param {string} [data.notes] - Additional notes
             * @returns {{ data: Object, rateLimit: Object }}
             */
            upsert(accountId, data) {
                return self.#request('PUT', `/accounts/${accountId}/internal-representatives/upsert`, { body: data });
            }
        };
    }

    // ───────────────────────────────────────────────────────────────────────
    // PARTY (auto-detection of contact vs internal representative)
    // ───────────────────────────────────────────────────────────────────────

    get party() {
        const self = this;
        return {
            /**
             * Upsert a party (auto-detects contact vs internal representative by email domain)
             * If email domain matches organization domain -> internal representative
             * Otherwise -> contact
             * @param {string} accountId - UUID of the account
             * @param {Object} data - Party data
             * @param {string} data.fullName - Full name (required for create)
             * @param {string} [data.email] - Email address (used for matching and type detection)
             * @param {string} data.language - Language code (required for create, e.g., 'fr', 'en')
             * @param {boolean} [data.isPrimary] - Whether this is the primary contact/representative
             * @param {string} [data.role] - Role or job title
             * @param {string} [data.notes] - Additional notes
             * @returns {{ data: Object, rateLimit: Object }}
             */
            upsert(accountId, data) {
                return self.#request('PUT', `/accounts/${accountId}/party/upsert`, { body: data });
            }
        };
    }

    // ───────────────────────────────────────────────────────────────────────
    // INVOICES
    // ───────────────────────────────────────────────────────────────────────

    get invoices() {
        const self = this;
        return {
            /**
             * List invoices for an organization
             * @param {Object} params - Query parameters
             * @param {string} params.organizationId - UUID of the organization (required)
             * @param {number} [params.first] - Number of items to return
             * @param {string} [params.after] - Cursor for pagination
             * @returns {{ data: { nodes: Array, pageInfo: { endCursor: string } }, rateLimit: Object }}
             */
            list({ organizationId, first, after }) {
                return self.#request('GET', '/invoices', {
                    query: { organizationId, first, after }
                });
            },

            /**
             * Get a specific invoice by ID
             * @param {string} invoiceId - UUID of the invoice
             * @returns {{ data: Object, rateLimit: Object }}
             */
            get(invoiceId) {
                return self.#request('GET', `/invoices/${invoiceId}`);
            },

            /**
             * Create a new invoice with file attachment
             * @param {Object} data - Invoice data
             * @param {string} data.organizationId - UUID of the organization
             * @param {string} data.accountId - UUID of the account
             * @param {string} data.number - Invoice number
             * @param {Object} data.issuedDate - Date object with year, month, day
             * @param {Object} data.dueDate - Date object with year, month, day
             * @param {number} data.totalAmount - Total amount including taxes
             * @param {number} data.taxAmount - Tax amount
             * @param {string} fileContent - File content (PDF or image)
             * @param {string} fileName - File name with extension
             * @returns {{ data: Object, rateLimit: Object }}
             */
            create(data, fileContent, fileName) {
                const boundary = '----BillabexBoundary' + Date.now();
                const body = self.#buildMultipartBody(boundary, data, fileContent, fileName);
                return self.#request('POST', '/invoices', {
                    body: {
                        _isMultipart: true,
                        contentType: `multipart/form-data; boundary=${boundary}`,
                        data: body
                    }
                });
            },

            /**
             * Delete an invoice
             * @param {string} invoiceId - UUID of the invoice
             * @returns {{ data: null, rateLimit: Object }}
             */
            delete(invoiceId) {
                return self.#request('DELETE', `/invoices/${invoiceId}`);
            },

            /**
             * Update the paid amount on an invoice
             * @param {string} invoiceId - UUID of the invoice
             * @param {Object} data - Paid amount data
             * @param {number} data.paidAmount - New paid amount
             * @param {Object} [data.paidDate] - Date object with year, month, day
             * @returns {{ data: Object, rateLimit: Object }}
             */
            updatePaidAmount(invoiceId, data) {
                return self.#request('PUT', `/invoices/${invoiceId}/paid-amount`, { body: data });
            }
        };
    }

    // ───────────────────────────────────────────────────────────────────────
    // CREDIT NOTES
    // ───────────────────────────────────────────────────────────────────────

    get creditNotes() {
        const self = this;
        return {
            /**
             * List credit notes for an organization
             * @param {Object} params - Query parameters
             * @param {string} params.organizationId - UUID of the organization (required)
             * @param {number} [params.first] - Number of items to return
             * @param {string} [params.after] - Cursor for pagination
             * @returns {{ data: { nodes: Array, pageInfo: { endCursor: string } }, rateLimit: Object }}
             */
            list({ organizationId, first, after }) {
                return self.#request('GET', '/credit-notes', {
                    query: { organizationId, first, after }
                });
            },

            /**
             * Get a specific credit note by ID
             * @param {string} creditNoteId - UUID of the credit note
             * @returns {{ data: Object, rateLimit: Object }}
             */
            get(creditNoteId) {
                return self.#request('GET', `/credit-notes/${creditNoteId}`);
            },

            /**
             * Create a new credit note with file attachment
             * @param {Object} data - Credit note data
             * @param {string} data.organizationId - UUID of the organization
             * @param {string} data.accountId - UUID of the account
             * @param {string} data.number - Credit note number
             * @param {Object} data.issuedDate - Date object with year, month, day
             * @param {number} data.totalAmount - Total amount including taxes
             * @param {number} data.taxAmount - Tax amount
             * @param {string} fileContent - File content (PDF or image)
             * @param {string} fileName - File name with extension
             * @returns {{ data: Object, rateLimit: Object }}
             */
            create(data, fileContent, fileName) {
                const boundary = '----BillabexBoundary' + Date.now();
                const body = self.#buildMultipartBody(boundary, data, fileContent, fileName);
                return self.#request('POST', '/credit-notes', {
                    body: {
                        _isMultipart: true,
                        contentType: `multipart/form-data; boundary=${boundary}`,
                        data: body
                    }
                });
            },

            /**
             * Delete a credit note
             * @param {string} creditNoteId - UUID of the credit note
             * @returns {{ data: null, rateLimit: Object }}
             */
            delete(creditNoteId) {
                return self.#request('DELETE', `/credit-notes/${creditNoteId}`);
            }
        };
    }

    // ───────────────────────────────────────────────────────────────────────
    // CREDIT ALLOCATIONS
    // ───────────────────────────────────────────────────────────────────────

    get creditAllocations() {
        const self = this;
        return {
            /**
             * Apply a credit allocation from a credit note to an invoice
             * @param {Object} data - Allocation data
             * @param {string} data.creditNoteId - UUID of the credit note
             * @param {string} data.invoiceId - UUID of the invoice
             * @param {number} data.amount - Amount to allocate
             * @returns {{ data: Object, rateLimit: Object }}
             */
            apply(data) {
                return self.#request('POST', '/credit-allocations', { body: data });
            },

            /**
             * Remove a credit allocation
             * @param {Object} data - Allocation data
             * @param {string} data.creditNoteId - UUID of the credit note
             * @param {string} data.invoiceId - UUID of the invoice
             * @param {number} data.amount - Amount to remove
             * @returns {{ data: null, rateLimit: Object }}
             */
            remove(data) {
                return self.#request('POST', '/credit-allocations/remove', { body: data });
            }
        };
    }

    // ───────────────────────────────────────────────────────────────────────
    // PAGINATION HELPER
    // ───────────────────────────────────────────────────────────────────────

    /**
     * Generator function for automatic pagination
     * @param {Function} resourceMethod - Method that returns paginated results
     * @param {Object} params - Parameters to pass to the method
     * @yields {{ data: { nodes: Array, pageInfo: Object }, rateLimit: Object }}
     * @example
     * for (const page of client.paginate(
     *     (p) => client.invoices.list(p),
     *     { organizationId: '...', first: 100 }
     * )) {
     *     for (const invoice of page.data.nodes) {
     *         // Process invoice
     *     }
     * }
     */
    *paginate(resourceMethod, params = {}) {
        let cursor = null;

        do {
            const result = resourceMethod({ ...params, after: cursor });
            yield result;

            cursor = result.data?.pageInfo?.endCursor || null;
        } while (cursor);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// MODULE EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

define(['N/https', 'N/log', './connection', './config'], (https, log, { getConnection }, { API_BASE }) => {

    // Initialize module-level config from centralized config module
    API_BASE_URL = API_BASE;

    /**
     * Create a new Billabex API client
     * @param {string} [connectionName='default'] - Name of the connection to use
     * @returns {BillabexApiClient} API client instance
     * @throws {Error} If the connection is not connected
     * @example
     * const client = createClient('default');
     * const orgs = client.organizations.list();
     */
    const createClient = (connectionName = 'default') => {
        return new BillabexApiClient(connectionName, https, log, getConnection);
    };

    return {
        createClient,
        BillabexApiClient,
        TokenExpiredError,
        RateLimitError,
        ApiError
    };
});
