/**
 * jwt.js
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */

define(['N/log', 'N/encode'], (log, encode) => {

    /**
     * Decode the payload of a JWT token
     * @param {string} token - The JWT token to decode
     * @returns {Object|null} - The decoded payload or null if invalid
     */
    const decodeJwtPayload = (token) => {
        try {
            if (!token || typeof token !== 'string') {
                return null;
            }

            // JWT format: header.payload.signature
            const parts = token.split('.');
            if (parts.length !== 3) {
                log.error('jwt.decodeJwtPayload.invalid_format', {
                    partsCount: parts.length
                });
                return null;
            }

            // Decode the payload (second part)
            const payload = parts[1];

            // Replace URL-safe chars and add padding if needed
            const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
            const paddedBase64 = base64 + '=='.substring(0, (4 - base64.length % 4) % 4);

            // Decode base64 and parse JSON using NetSuite encode module
            const decoded = encode.convert({
                string: paddedBase64,
                inputEncoding: encode.Encoding.BASE_64,
                outputEncoding: encode.Encoding.UTF_8
            });
            return JSON.parse(decoded);
        } catch (e) {
            log.error('jwt.decodeJwtPayload.error', {
                error: e.message,
                stack: e.stack
            });
            return null;
        }
    };

    /**
     * Get the expiration date from a JWT token
     * @param {string} token - The JWT token
     * @returns {Date|null} - The expiration date or null if not found
     */
    const getTokenExpiration = (token) => {
        const payload = decodeJwtPayload(token);
        if (payload && payload.exp) {
            // exp is Unix timestamp in seconds, convert to milliseconds
            return new Date(payload.exp * 1000);
        }
        return null;
    };

    /**
     * Check if a JWT token is expired
     * @param {string} token - The JWT token
     * @returns {boolean} - True if expired, false otherwise
     */
    const isTokenExpired = (token) => {
        const expiration = getTokenExpiration(token);
        if (!expiration) {
            return true; // Consider invalid tokens as expired
        }
        return expiration.getTime() < Date.now();
    };

    /**
     * Get all claims from a JWT token
     * @param {string} token - The JWT token
     * @returns {Object|null} - All claims or null if invalid
     */
    const getTokenClaims = (token) => {
        return decodeJwtPayload(token);
    };

    return {
        decodeJwtPayload,
        getTokenExpiration,
        isTokenExpired,
        getTokenClaims
    };
});
