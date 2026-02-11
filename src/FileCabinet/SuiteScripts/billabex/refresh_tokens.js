/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * @NModuleScope SameAccount
 */
define(['./libs/connection', './libs/oauth', './libs/jwt', 'N/log'], ({ getConnectedConnections }, oauth, jwt, log) => {

    const execute = () => {
        log.debug('refresh_tokens.start');

        const connections = getConnectedConnections();
        log.debug('refresh_tokens.connections', { count: connections.length });

        connections.forEach((connection) => {
            try {
                // Skip if refresh token is expired (can't refresh)
                if (connection.oauthRefreshExpiresAt) {
                    const refreshExpiresAt = new Date(connection.oauthRefreshExpiresAt);
                    if (!Number.isNaN(refreshExpiresAt.getTime()) && refreshExpiresAt.getTime() < Date.now()) {
                        log.error('refresh_tokens.skip_expired_refresh', {
                            connectionId: connection.id,
                            connectionName: connection.name,
                            refreshExpiresAt: connection.oauthRefreshExpiresAt
                        });
                        return;
                    }
                }

                const result = oauth.refreshTokens({
                    refreshToken: connection.oauthRefreshToken,
                    clientId: connection.oauthClientId,
                    clientSecret: connection.oauthClientSecret
                });

                if (!result.ok) {
                    log.error('refresh_tokens.failed', {
                        connectionId: connection.id,
                        connectionName: connection.name,
                        status: result.status,
                        error: result.error
                    });
                    return;
                }

                const tokenBody = result.data;
                const accessExpiresAt = jwt.getTokenExpiration(tokenBody.access_token);
                const refreshToken = tokenBody.refresh_token || connection.oauthRefreshToken;
                const currentRefreshExpiresAt = connection.oauthRefreshExpiresAt || null;
                const refreshExpiresAt = tokenBody.refresh_token
                    ? jwt.getTokenExpiration(tokenBody.refresh_token)
                    : currentRefreshExpiresAt;

                connection.setupOAuthTokens({
                    oauthAccessToken: tokenBody.access_token,
                    oauthAccessExpiresAt: accessExpiresAt ? accessExpiresAt.toISOString() : null,
                    oauthRefreshToken: refreshToken,
                    oauthRefreshExpiresAt: refreshExpiresAt instanceof Date
                        ? refreshExpiresAt.toISOString()
                        : refreshExpiresAt,
                    connected: true
                });

                log.debug('refresh_tokens.success', {
                    connectionId: connection.id,
                    connectionName: connection.name,
                    accessExpiresAt: accessExpiresAt ? accessExpiresAt.toISOString() : null,
                    rotatedRefreshToken: !!tokenBody.refresh_token
                });
            } catch (error) {
                log.error('refresh_tokens.error', {
                    connectionId: connection.id,
                    connectionName: connection.name,
                    message: error.message,
                    stack: error.stack
                });
            }
        });
    };

    return { execute };
});
