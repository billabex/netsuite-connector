/**
 * components.js
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */

class Connection {

    #query
    #record
    #id
    #name
    #organizationId
    #oauthClientId
    #oauthClientSecret
    #oauthRegistrationToken
    #oauthAccessToken
    #oauthAccessExpiresAt
    #oauthRefreshToken
    #oauthRefreshExpiresAt
    #oauthPkceVerifier
    #oauthPkceState
    #connected

    constructor({
        id,
        name,
        organizationId,
        oauthClientId,
        oauthClientSecret,
        oauthRegistrationToken,
        oauthAccessToken,
        oauthAccessExpiresAt,
        oauthRefreshToken,
        oauthRefreshExpiresAt,
        oauthPkceVerifier,
        oauthPkceState,
        connected
    },
        query,
        record,
    ) {
        if (!name) {
            throw new Error('Connection name is required to create a connection');
        }
        this.#query = query;
        this.#record = record;
        this.#id = id || null;
        this.#name = name;
        this.#organizationId = organizationId || null;
        this.#oauthClientId = oauthClientId || null;
        this.#oauthClientSecret = oauthClientSecret || null;
        this.#oauthRegistrationToken = oauthRegistrationToken || null;
        this.#oauthAccessToken = oauthAccessToken || null;
        this.#oauthAccessExpiresAt = oauthAccessExpiresAt || null;
        this.#oauthRefreshToken = oauthRefreshToken || null;
        this.#oauthRefreshExpiresAt = oauthRefreshExpiresAt || null;
        this.#oauthPkceVerifier = oauthPkceVerifier || null;
        this.#oauthPkceState = oauthPkceState || null;
        this.#connected = connected || false;
    }

    // Getters for private fields
    get oauthClientId() {
        return this.#oauthClientId;
    }

    get oauthClientSecret() {
        return this.#oauthClientSecret;
    }

    get id() {
        return this.#id;
    }

    get name() {
        return this.#name;
    }

    get oauthRegistrationToken() {
        return this.#oauthRegistrationToken;
    }

    get oauthPkceState() {
        return this.#oauthPkceState;
    }

    get oauthPkceVerifier() {
        return this.#oauthPkceVerifier;
    }

    get oauthRefreshToken() {
        return this.#oauthRefreshToken;
    }

    get oauthRefreshExpiresAt() {
        return this.#oauthRefreshExpiresAt;
    }

    get organizationId() {
        return this.#organizationId;
    }

    get connected() {
        return this.#connected;
    }

    get oauthAccessToken() {
        return this.#oauthAccessToken;
    }

    get oauthAccessExpiresAt() {
        return this.#oauthAccessExpiresAt;
    }

    /**
     * Checks if the access token is valid and not expiring soon
     * @param {number} marginMinutes - Safety margin in minutes (default: 5)
     * @returns {boolean} true if token is valid and won't expire within the margin
     */
    isAccessTokenValid(marginMinutes = 5) {
        if (!this.#oauthAccessToken || !this.#oauthAccessExpiresAt) {
            return false;
        }
        const expiresAt = new Date(this.#oauthAccessExpiresAt);
        if (Number.isNaN(expiresAt.getTime())) {
            return false;
        }
        const now = new Date();
        const marginMs = marginMinutes * 60 * 1000;
        return expiresAt.getTime() - marginMs > now.getTime();
    }

    hasOAuthClient() {
        return !!(this.#oauthClientId && this.#oauthClientSecret);
    }

    hasOrganization() {
        return !!this.#organizationId;
    }

    setOrganizationId(organizationId) {
        this.#organizationId = organizationId;
        this.save();
    }

    isConnected() {
        return this.#connected;
    }

    setupOAuthClient({ oauthClientId, oauthClientSecret, oauthRegistrationToken, oauthPkceState, oauthPkceVerifier }) {
        this.#oauthClientId = oauthClientId;
        this.#oauthClientSecret = oauthClientSecret;
        this.#oauthRegistrationToken = oauthRegistrationToken;
        this.#oauthPkceState = oauthPkceState;
        this.#oauthPkceVerifier = oauthPkceVerifier;
        this.save();
    }

    setupOAuthTokens({ oauthAccessToken, oauthAccessExpiresAt, oauthRefreshToken, oauthRefreshExpiresAt }) {
        this.#oauthAccessToken = oauthAccessToken;
        this.#oauthAccessExpiresAt = oauthAccessExpiresAt;
        this.#oauthRefreshToken = oauthRefreshToken;
        this.#oauthRefreshExpiresAt = oauthRefreshExpiresAt;
        this.#connected = true;
        this.save();
    }

    save() {
        let rec;

        if (this.#id) {
            // Update existing record
            rec = this.#record.load({
                type: 'customrecord_bbx_cx',
                id: this.#id
            });
        } else {
            const results = this.#query.runSuiteQL({
                query: `SELECT 
                cx.id AS id
            FROM customrecord_bbx_cx cx WHERE cx.name = '${this.#name}'`,
                customScriptId: 'customrecord_bbx_cx_save_connection',
            }).results;

            if (results.length > 0) {
                // Record exists, load it
                this.#id = results[0].asMap().id;

                rec = this.#record.load({
                    type: 'customrecord_bbx_cx',
                    id: this.#id
                });
            } else {
                // Create new record
                rec = this.#record.create({
                    type: 'customrecord_bbx_cx'
                });
                // Set the native name field (required for new records only)
                rec.setValue({ fieldId: 'name', value: this.#name });
            }
        }
        // Set all fields (skip null/undefined/empty values)
        if (this.#organizationId) {
            rec.setValue({ fieldId: 'custrecord_bbx_cx_org_id', value: this.#organizationId });
        }
        if (this.#oauthClientId) {
            rec.setValue({ fieldId: 'custrecord_bbx_cx_client_id', value: this.#oauthClientId });
        }
        if (this.#oauthClientSecret) {
            rec.setValue({ fieldId: 'custrecord_bbx_cx_client_secret', value: this.#oauthClientSecret });
        }
        if (this.#oauthRegistrationToken) {
            rec.setValue({ fieldId: 'custrecord_bbx_cx_registration_token', value: this.#oauthRegistrationToken });
        }
        if (this.#oauthAccessToken) {
            rec.setValue({ fieldId: 'custrecord_bbx_cx_access_token', value: this.#oauthAccessToken });
        }
        if (this.#oauthAccessExpiresAt) {
            rec.setValue({ fieldId: 'custrecord_bbx_cx_access_expires_at', value: this.#oauthAccessExpiresAt });
        }
        if (this.#oauthRefreshToken) {
            rec.setValue({ fieldId: 'custrecord_bbx_cx_refresh_token', value: this.#oauthRefreshToken });
        }
        if (this.#oauthRefreshExpiresAt) {
            rec.setValue({ fieldId: 'custrecord_bbx_cx_refresh_expires_at', value: this.#oauthRefreshExpiresAt });
        }
        if (this.#oauthPkceVerifier) {
            rec.setValue({ fieldId: 'custrecord_bbx_cx_pkce_verifier', value: this.#oauthPkceVerifier });
        }
        if (this.#oauthPkceState) {
            rec.setValue({ fieldId: 'custrecord_bbx_cx_pkce_state', value: this.#oauthPkceState });
        }
        rec.setValue({ fieldId: 'custrecord_bbx_cx_connected', value: !!this.#connected });

        // Save and store the ID
        this.#id = rec.save();
    }

    delete() {
        if (this.#id) {
            this.#record.delete({
                type: 'customrecord_bbx_cx',
                id: this.#id
            });
        } else {
            const results = this.#query.runSuiteQL({
                query: `SELECT 
                cx.id AS id
            FROM customrecord_bbx_cx cx WHERE cx.name = '${this.#name}'`,
                customScriptId: 'customrecord_bbx_cx_delete_connection',
            }).results;

            if (results.length > 0) {
                this.#record.delete({
                    type: 'customrecord_bbx_cx',
                    id: results[0].asMap().id
                });
            }
        }
    }
}

define(['N/query', 'N/record'], (query, record) => {

    const getConnection = (name) => {

        if (!name) {
            throw new Error('Connection name is required to retrieve a connection');
        }

        const results = query.runSuiteQL({
            query: `SELECT 
                cx.id AS id,
                cx.name AS name,
                cx.custrecord_bbx_cx_org_id AS organization_id,
                cx.custrecord_bbx_cx_client_id AS oauth_client_id,
                cx.custrecord_bbx_cx_client_secret AS oauth_client_secret,
                cx.custrecord_bbx_cx_registration_token AS oauth_registration_token,
                cx.custrecord_bbx_cx_access_token AS oauth_access_token,
                cx.custrecord_bbx_cx_access_expires_at AS oauth_access_expires_at,
                cx.custrecord_bbx_cx_refresh_token AS oauth_refresh_token,
                cx.custrecord_bbx_cx_refresh_expires_at AS oauth_refresh_expires_at,
                cx.custrecord_bbx_cx_pkce_verifier AS oauth_pkce_verifier,
                cx.custrecord_bbx_cx_pkce_state AS oauth_pkce_state,
                cx.custrecord_bbx_cx_connected AS connected
            FROM customrecord_bbx_cx cx WHERE cx.name = '${name}'`,

            customScriptId: 'customrecord_bbx_cx_get_connection',
        }).results;

        if (results.length === 0) {
            return new Connection({
                id: null,
                name,
                organizationId: null,
                oauthClientId: null,
                oauthClientSecret: null,
                oauthRegistrationToken: null,
                oauthAccessToken: null,
                oauthAccessExpiresAt: null,
                oauthRefreshToken: null,
                oauthRefreshExpiresAt: null,
                oauthPkceVerifier: null,
                oauthPkceState: null,
                connected: false
            }, query, record);
        }

        const result = results[0].asMap();

        return new Connection({
            id: result.id,
            name: result.name,
            organizationId: result.organization_id,
            oauthClientId: result.oauth_client_id,
            oauthClientSecret: result.oauth_client_secret,
            oauthRegistrationToken: result.oauth_registration_token,
            oauthAccessToken: result.oauth_access_token,
            oauthAccessExpiresAt: result.oauth_access_expires_at,
            oauthRefreshToken: result.oauth_refresh_token,
            oauthRefreshExpiresAt: result.oauth_refresh_expires_at,
            oauthPkceVerifier: result.oauth_pkce_verifier,
            oauthPkceState: result.oauth_pkce_state,
            connected: result.connected === 'T' || result.connected === true
        }, query, record);
    };

    const getConnectedConnections = () => {
        const results = query.runSuiteQL({
            query: `SELECT
                cx.id AS id,
                cx.name AS name,
                cx.custrecord_bbx_cx_org_id AS organization_id,
                cx.custrecord_bbx_cx_client_id AS oauth_client_id,
                cx.custrecord_bbx_cx_client_secret AS oauth_client_secret,
                cx.custrecord_bbx_cx_registration_token AS oauth_registration_token,
                cx.custrecord_bbx_cx_access_token AS oauth_access_token,
                cx.custrecord_bbx_cx_access_expires_at AS oauth_access_expires_at,
                cx.custrecord_bbx_cx_refresh_token AS oauth_refresh_token,
                cx.custrecord_bbx_cx_refresh_expires_at AS oauth_refresh_expires_at,
                cx.custrecord_bbx_cx_pkce_verifier AS oauth_pkce_verifier,
                cx.custrecord_bbx_cx_pkce_state AS oauth_pkce_state,
                cx.custrecord_bbx_cx_connected AS connected
            FROM customrecord_bbx_cx cx
            WHERE cx.custrecord_bbx_cx_connected = 'T'
              AND cx.custrecord_bbx_cx_refresh_token IS NOT NULL`,
            customScriptId: 'customrecord_bbx_cx_get_connected'
        }).results;

        return results.map((row) => {
            const result = row.asMap();
            return new Connection({
                id: result.id,
                name: result.name,
                organizationId: result.organization_id,
                oauthClientId: result.oauth_client_id,
                oauthClientSecret: result.oauth_client_secret,
                oauthRegistrationToken: result.oauth_registration_token,
                oauthAccessToken: result.oauth_access_token,
                oauthAccessExpiresAt: result.oauth_access_expires_at,
                oauthRefreshToken: result.oauth_refresh_token,
                oauthRefreshExpiresAt: result.oauth_refresh_expires_at,
                oauthPkceVerifier: result.oauth_pkce_verifier,
                oauthPkceState: result.oauth_pkce_state,
                connected: result.connected === 'T' || result.connected === true
            }, query, record);
        });
    };

    return {
        getConnection,
        getConnectedConnections
    };
});
