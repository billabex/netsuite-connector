/**
 * oauth.js
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */

define(['N/https', 'N/crypto/random', 'N/crypto', 'N/encode', 'N/log', './config'], (https, { generateBytes }, { createHash, HashAlg }, { Encoding }, log, { OAUTH_ENDPOINTS }) => {

    const DEFAULT_SCOPES = [
        'invoices:all',
        'credit-notes:all',
        'accounts:all',
        'organizations:read'
    ];

    const base64UrlEncode = (value) => value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

    const createRandomString = (length) => {
        const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
        const bytes = Array.from(generateBytes({ size: length }));
        let output = '';

        for (let index = 0; index < length; index += 1) {
            output += charset.charAt(bytes[index] % charset.length);
        }

        return output;
    };

    const createCodeChallenge = (verifier) => {
        const hash = createHash({
            algorithm: HashAlg.SHA256
        });
        hash.update({ input: verifier });
        const digest = hash.digest({ outputEncoding: Encoding.BASE_64 });
        return base64UrlEncode(digest);
    };

    const buildQueryString = (params) => Object.keys(params)
        .filter((key) => params[key] !== undefined && params[key] !== null)
        .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
        .join('&');

    const getDefaultScopes = () => DEFAULT_SCOPES.slice();

    const createPkcePair = () => {
        const verifier = createRandomString(64);
        const challenge = createCodeChallenge(verifier);
        log.debug('oauth.createPkcePair', {
            hasVerifier: !!verifier,
            hasChallenge: !!challenge
        });
        return { verifier, challenge };
    };

    const createState = () => {
        const state = createRandomString(32);
        log.debug('oauth.createState', {
            hasState: !!state
        });
        return state;
    };

    const buildAuthorizationUrl = ({ clientId, redirectURI, state, codeChallenge, scopes }) => {
        const scopeList = (scopes && scopes.length) ? scopes : DEFAULT_SCOPES;
        const query = buildQueryString({
            response_type: 'code',
            client_id: clientId,
            redirect_uri: redirectURI,
            scope: scopeList.join(' '),
            state,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256'
        });

        log.debug('oauth.buildAuthorizationUrl', {
            hasClientId: !!clientId,
            scopeCount: scopeList.length,
            hasRedirectURI: !!redirectURI,
            hasState: !!state,
            hasCodeChallenge: !!codeChallenge
        });

        return `${OAUTH_ENDPOINTS.authorization}?${query}`;
    };

    const registerClient = ({ redirectURI, scopes, clientName, tokenEndpointAuthMethod }) => {
        const scopeList = (scopes && scopes.length) ? scopes : DEFAULT_SCOPES;
        const payload = {
            client_name: clientName || 'Billabex NetSuite Connector',
            redirect_uris: [redirectURI],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: tokenEndpointAuthMethod || 'client_secret_post',
            scope: scopeList.join(' ')
        };

        log.debug('oauth.registerClient.start', {
            hasRedirectURI: !!redirectURI,
            scopeCount: scopeList.length,
            tokenEndpointAuthMethod: payload.token_endpoint_auth_method
        });

        const response = https.post({
            url: OAUTH_ENDPOINTS.registration,
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify(payload)
        });

        log.debug('oauth.registerClient.response', {
            status: response.code
        });

        if (response.code < 200 || response.code >= 300) {
            return { ok: false, status: response.code, error: 'Registration failed.' };
        }

        let body;
        try {
            body = JSON.parse(response.body || '{}');
        } catch (error) {
            return { ok: false, status: response.code, error: 'Registration response was not valid JSON.' };
        }

        if (!body.client_id) {
            return { ok: false, status: response.code, error: 'Registration response missing client_id.' };
        }

        log.debug('oauth.registerClient.success', {
            hasClientId: !!body.client_id,
            hasClientSecret: !!body.client_secret,
            hasRegistrationToken: !!body.registration_access_token
        });

        return { ok: true, status: response.code, data: body };
    };

    const exchangeCodeForTokens = ({ code, redirectURI, clientId, clientSecret, codeVerifier }) => {
        log.debug('oauth.exchangeCodeForTokens.start', {
            hasCode: !!code,
            hasRedirectURI: !!redirectURI,
            hasClientId: !!clientId,
            hasClientSecret: !!clientSecret,
            hasCodeVerifier: !!codeVerifier
        });
        const response = https.post({
            url: OAUTH_ENDPOINTS.token,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json'
            },
            body: buildQueryString({
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectURI,
                client_id: clientId,
                client_secret: clientSecret || undefined,
                code_verifier: codeVerifier
            })
        });

        log.debug('oauth.exchangeCodeForTokens.response', {
            status: response.code,
            bodyLength: response.body ? response.body.length : 0
        });

        if (response.code < 200 || response.code >= 300) {
            let errorDetail = 'Token exchange failed.';
            try {
                const errorBody = JSON.parse(response.body || '{}');
                log.error('oauth.exchangeCodeForTokens.error', {
                    status: response.code,
                    errorBody: errorBody
                });
                errorDetail = errorBody.message || errorBody.error || errorDetail;
            } catch (e) {
                log.error('oauth.exchangeCodeForTokens.error', {
                    status: response.code,
                    body: response.body
                });
            }
            return { ok: false, status: response.code, error: errorDetail };
        }

        let body;
        try {
            body = JSON.parse(response.body || '{}');
        } catch (error) {
            return { ok: false, status: response.code, error: 'Token response was not valid JSON.' };
        }

        if (!body.access_token) {
            return { ok: false, status: response.code, error: 'Token response missing access_token.', data: body };
        }

        log.debug('oauth.exchangeCodeForTokens.success', {
            hasAccessToken: !!body.access_token,
            hasRefreshToken: !!body.refresh_token,
            hasExpiresIn: !!body.expires_in
        });

        return { ok: true, status: response.code, data: body };
    };

    const refreshTokens = ({ refreshToken, clientId, clientSecret }) => {
        log.debug('oauth.refreshTokens.start', {
            hasRefreshToken: !!refreshToken,
            hasClientId: !!clientId,
            hasClientSecret: !!clientSecret
        });

        const response = https.post({
            url: OAUTH_ENDPOINTS.token,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json'
            },
            body: buildQueryString({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: clientId,
                client_secret: clientSecret || undefined
            })
        });

        log.debug('oauth.refreshTokens.response', {
            status: response.code,
            bodyLength: response.body ? response.body.length : 0
        });

        if (response.code < 200 || response.code >= 300) {
            let errorDetail = 'Token refresh failed.';
            try {
                const errorBody = JSON.parse(response.body || '{}');
                log.error('oauth.refreshTokens.error', {
                    status: response.code,
                    errorBody: errorBody
                });
                errorDetail = errorBody.message || errorBody.error || errorDetail;
            } catch (e) {
                log.error('oauth.refreshTokens.error', {
                    status: response.code,
                    body: response.body
                });
            }
            return { ok: false, status: response.code, error: errorDetail };
        }

        let body;
        try {
            body = JSON.parse(response.body || '{}');
        } catch (error) {
            return { ok: false, status: response.code, error: 'Token response was not valid JSON.' };
        }

        if (!body.access_token) {
            return { ok: false, status: response.code, error: 'Token response missing access_token.', data: body };
        }

        log.debug('oauth.refreshTokens.success', {
            hasAccessToken: !!body.access_token,
            hasRefreshToken: !!body.refresh_token,
            hasExpiresIn: !!body.expires_in
        });

        return { ok: true, status: response.code, data: body };
    };

    return {
        buildAuthorizationUrl,
        createPkcePair,
        createState,
        exchangeCodeForTokens,
        getDefaultScopes,
        registerClient,
        refreshTokens
    };
});
