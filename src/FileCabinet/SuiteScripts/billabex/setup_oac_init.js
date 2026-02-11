/**
*@NApiVersion 2.1
*@NScriptType Suitelet
*@NModuleScope SameAccount
*/
define(['./libs/connection', './libs/oauth', 'N/url', 'N/log'], ({ getConnection }, oauth, { resolveScript, resolveDomain, HostType }, log) => {

    const writeRedirect = (context, url) => {
        const safeUrl = url.replace(/"/g, '&quot;');
        context.response.write(`<!doctype html><html><head><meta http-equiv="refresh" content="0;url=${safeUrl}"></head><body><a href="${safeUrl}">Continue</a></body></html>`);
    };

    const writeError = (context, message) => {
        context.response.write(`<!doctype html><html><body><h2>OAuth setup failed</h2><p>${message}</p></body></html>`);
    };
    const onRequest = (context) => {

        const connectionName = context.request.parameters.connectName ?? 'default';
        log.debug('setup_oac_init.start', {
            connectionName
        });

        const connection = getConnection(connectionName);
        log.debug('setup_oac_init.connection', {
            hasOAuthClient: connection.hasOAuthClient(),
            isConnected: connection.isConnected()
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
        log.debug('setup_oac_init.callback_url', {
            hasCallbackURL: !!callbackURL,
            callbackURL
        });

        const pkceState = oauth.createState();
        const pkcePair = oauth.createPkcePair();

        if (!connection.hasOAuthClient()) {
            log.debug('setup_oac_init.register', {
                redirectURI: callbackURL
            });
            const registrationResult = oauth.registerClient({
                redirectURI: callbackURL,
            });

            if (!registrationResult.ok) {
                writeError(context, `${registrationResult.error} (${registrationResult.status}).`);
                return;
            }
            const registrationBody = registrationResult.data;
            log.debug('setup_oac_init.register.success', {
                hasClientId: !!registrationBody.client_id
            });

            connection.setupOAuthClient({
                oauthClientId: registrationBody.client_id,
                oauthClientSecret: registrationBody.client_secret || '',
                oauthRegistrationToken: registrationBody.registration_access_token || '',
                oauthPkceState: pkceState,
                oauthPkceVerifier: pkcePair.verifier
            });
        } else {
            log.debug('setup_oac_init.register.skip', {
                reason: 'client_already_registered'
            });
            connection.setupOAuthClient({
                oauthClientId: connection.oauthClientId,
                oauthClientSecret: connection.oauthClientSecret || '',
                oauthRegistrationToken: connection.oauthRegistrationToken || '',
                oauthPkceState: pkceState,
                oauthPkceVerifier: pkcePair.verifier
            });
        }

        const authorizationUrl = oauth.buildAuthorizationUrl({
            clientId: connection.oauthClientId,
            redirectURI: callbackURL,
            state: pkceState,
            codeChallenge: pkcePair.challenge
        });
        log.debug('setup_oac_init.redirect', {
            hasAuthorizationUrl: !!authorizationUrl
        });

        writeRedirect(context, authorizationUrl);
    }

    return { onRequest }
});
