/**
 * config.js
 * Centralized configuration for the Billabex connector.
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([], () => {

    // ═══════════════════════════════════════════════════════════════════════════
    // API ENDPOINTS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Base URL for the Billabex platform.
     * Production: https://next.billabex.com
     * Staging:    https://next.staging.billabex.com
     */
    const BASE_URL = 'https://next.billabex.com';

    /**
     * Base URL for the Billabex Public API (v1).
     */
    const API_BASE = `${BASE_URL}/api/public/v1`;

    /**
     * OAuth endpoints derived from BASE_URL.
     */
    const OAUTH_ENDPOINTS = {
        authorization: `${BASE_URL}/api/oauth/authorize`,
        token: `${BASE_URL}/api/oauth/token`,
        registration: `${BASE_URL}/api/oauth/register`
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // EMAIL SETTINGS (Sandbox Safety)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * When true, contact emails are replaced by OVERRIDE_EMAIL
     * to prevent sending real emails from sandbox/staging environments.
     * Set to false for production deployments.
     */
    const SANDBOX_MODE = false;

    /**
     * Email used for all contacts when SANDBOX_MODE is true.
     * Replace with your own testing email when using sandbox mode.
     * Ignored when SANDBOX_MODE is false.
     */
    const OVERRIDE_EMAIL = 'your-test-email@example.com';

    // ═══════════════════════════════════════════════════════════════════════════
    // GENERAL SETTINGS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Default language code for contacts (ISO 639-1).
     * Used when creating contacts in Billabex.
     */
    const DEFAULT_LANGUAGE = 'fr';

    // ═══════════════════════════════════════════════════════════════════════════
    // SOURCE SETTINGS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Connection ID for the source reference.
     * This identifies the NetSuite integration in Billabex.
     * Used to link accounts to their NetSuite source records.
     */
    const CONNECTION_ID = 'netsuite-connector';

    // ═══════════════════════════════════════════════════════════════════════════
    // HELPER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Resolve the email to use for a contact.
     * In sandbox mode, returns the override email.
     * In production mode, returns the actual email (or null).
     * @param {string|null} realEmail - The actual email address
     * @returns {string|null}
     */
    const resolveEmail = (realEmail) => {
        if (SANDBOX_MODE && realEmail) {
            return OVERRIDE_EMAIL;
        }
        return realEmail || null;
    };

    return {
        BASE_URL,
        API_BASE,
        OAUTH_ENDPOINTS,
        SANDBOX_MODE,
        OVERRIDE_EMAIL,
        DEFAULT_LANGUAGE,
        CONNECTION_ID,
        resolveEmail
    };
});
