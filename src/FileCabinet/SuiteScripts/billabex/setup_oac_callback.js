/**
*@NApiVersion 2.1
*@NScriptType Suitelet
*@NModuleScope SameAccount
*/
define(['./libs/connection', './libs/oauth', './libs/jwt', 'N/url', 'N/log'], ({ getConnection }, oauth, jwt, { resolveScript, resolveDomain, HostType }, log) => {

    const writeRedirect = (context, url) => {
        const safeUrl = url.replace(/"/g, '&quot;');
        context.response.write(`<!doctype html><html><head><meta http-equiv="refresh" content="0;url=${safeUrl}"></head><body><a href="${safeUrl}">Continue</a></body></html>`);
    };

    const writePage = (context, title, message) => {
        context.response.write(`<!doctype html><html><body><h2>${title}</h2><p>${message}</p></body></html>`);
    };

    const onRequest = (context) => {
        const parameters = context.request.parameters || {};
        const connectionName = parameters.connectName ?? 'default';
        const code = parameters.code;
        const state = parameters.state;
        log.debug('setup_oac_callback.start', {
            connectionName,
            hasCode: !!code,
            hasState: !!state
        });

        if (!code) {
            writePage(context, 'OAuth callback failed', 'Missing authorization code.');
            return;
        }

        const connection = getConnection(connectionName);
        log.debug('setup_oac_callback.connection', {
            hasOAuthClient: connection.hasOAuthClient()
        });

        if (!connection.hasOAuthClient()) {
            writePage(context, 'OAuth callback failed', 'OAuth client is not registered.');
            return;
        }

        if (!state || state !== connection.oauthPkceState) {
            writePage(context, 'OAuth callback failed', 'Invalid OAuth state.');
            return;
        }
        log.debug('setup_oac_callback.state', {
            isValid: true
        });

        const callbackURLRealtive = resolveScript({
            scriptId: 'customscript_bbx_setup_oac_callback',
            deploymentId: 'customdeploy_bbx_oac_callback',
            params: {
                connectName: connectionName
            }
        });
        const domain = resolveDomain({ hostType: HostType.APPLICATION });
        const callbackURL = `https://${domain}${callbackURLRealtive}`;
        log.debug('setup_oac_callback.callback_url', {
            hasCallbackURL: !!callbackURL,
            callbackURL
        });
        if (!callbackURL) {
            writePage(context, 'OAuth callback failed', 'Missing callback URL.');
            return;
        }
        const redirectURI = callbackURL;
        log.debug('setup_oac_callback.exchange_token.params', {
            hasCode: !!code,
            hasRedirectURI: !!redirectURI,
            hasClientId: !!connection.oauthClientId,
            hasClientSecret: !!connection.oauthClientSecret,
            hasCodeVerifier: !!connection.oauthPkceVerifier,
            redirectURI: redirectURI
        });
        const tokenResult = oauth.exchangeCodeForTokens({
            code,
            redirectURI,
            clientId: connection.oauthClientId,
            clientSecret: connection.oauthClientSecret,
            codeVerifier: connection.oauthPkceVerifier
        });

        if (!tokenResult.ok) {
            writePage(context, 'OAuth callback failed', `${tokenResult.error} (${tokenResult.status}).`);
            return;
        }
        const tokenBody = tokenResult.data;
        log.debug('setup_oac_callback.token', {
            hasAccessToken: !!tokenBody.access_token,
            hasRefreshToken: !!tokenBody.refresh_token
        });

        const accessExpiresAt = jwt.getTokenExpiration(tokenBody.access_token);
        const refreshExpiresAt = tokenBody.refresh_token
            ? jwt.getTokenExpiration(tokenBody.refresh_token)
            : null;

        log.debug('setup_oac_callback.token_expiration', {
            accessExpiresAt: accessExpiresAt ? accessExpiresAt.toISOString() : null,
            refreshExpiresAt: refreshExpiresAt ? refreshExpiresAt.toISOString() : null
        });

        connection.setupOAuthTokens({
            oauthAccessToken: tokenBody.access_token,
            oauthAccessExpiresAt: accessExpiresAt ? accessExpiresAt.toISOString() : null,
            oauthRefreshToken: tokenBody.refresh_token || '',
            oauthRefreshExpiresAt: refreshExpiresAt ? refreshExpiresAt.toISOString() : null,
            connected: true
        });
        log.debug('setup_oac_callback.tokens_saved', {
            accessExpiresAt,
            refreshExpiresAt
        });

        const endUrl = resolveScript({
            scriptId: 'customscript_bbx_setup',
            deploymentId: 'customdeploy_bbx_setup',
            returnExternalUrl: false,
            params: {
                connectName: connectionName
            }
        });

        log.debug('setup_oac_callback.redirect', {
            hasEndUrl: !!endUrl
        });

        writeRedirect(context, endUrl);
    }

    return { onRequest }
});
