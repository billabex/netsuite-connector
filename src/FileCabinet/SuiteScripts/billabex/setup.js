/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define([
    './libs/template',
    './libs/components',
    './libs/connection',
    './libs/billabex-api',
    'N/url',
    'N/redirect',
    'N/log',
    'N/task'
], (
    { layout, render },
    { Button, Status, Select, SubmitButton },
    { getConnection },
    { createClient, TokenExpiredError },
    { resolveScript },
    redirect,
    log,
    task
) => {
    const onRequest = (context) => {
        const connectionName = 'default';
        const connection = getConnection(connectionName);

        // ─────────────────────────────────────────────────────────────────
        // HANDLE POST - Save organization selection or trigger sync
        // ─────────────────────────────────────────────────────────────────
        if (context.request.method === 'POST') {
            const action = context.request.parameters.action;

            // Handle full sync trigger
            if (action === 'full_sync' && connection.isConnected() && connection.hasOrganization()) {
                log.debug('setup.POST', { action: 'full_sync' });

                try {
                    const mrTask = task.create({
                        taskType: task.TaskType.MAP_REDUCE,
                        scriptId: 'customscript_bbx_full_sync',
                        deploymentId: 'customdeploy_bbx_full_sync'
                    });
                    const taskId = mrTask.submit();
                    log.audit('setup.POST', { action: 'full_sync', taskId });

                    redirect.toSuitelet({
                        scriptId: 'customscript_bbx_setup',
                        deploymentId: 'customdeploy_bbx_setup',
                        parameters: { syncStarted: 'T', taskId }
                    });
                } catch (e) {
                    log.error('setup.POST full_sync error', { name: e.name, message: e.message });
                    redirect.toSuitelet({
                        scriptId: 'customscript_bbx_setup',
                        deploymentId: 'customdeploy_bbx_setup',
                        parameters: { syncError: e.message }
                    });
                }
                return;
            }

            // Handle organization selection
            const rawValue = context.request.parameters.organizationId;
            const separatorIndex = rawValue ? rawValue.indexOf('|') : -1;
            const organizationId = separatorIndex > -1 ? rawValue.substring(0, separatorIndex) : rawValue;
            const organizationName = separatorIndex > -1 ? rawValue.substring(separatorIndex + 1) : '';

            log.debug('setup.POST', { organizationId, organizationName, isConnected: connection.isConnected() });

            if (organizationId && connection.isConnected()) {
                connection.setOrganizationId(organizationId);

                // Redirect to GET to refresh the page, passing org name
                redirect.toSuitelet({
                    scriptId: 'customscript_bbx_setup',
                    deploymentId: 'customdeploy_bbx_setup',
                    parameters: { orgName: organizationName }
                });
                return;
            }
        }

        // ─────────────────────────────────────────────────────────────────
        // HANDLE GET - Display page
        // ─────────────────────────────────────────────────────────────────
        let status, nextAction, nextTitle;

        // Case 1: Not connected
        if (!connection.hasOAuthClient() || !connection.isConnected()) {
            const oacInitURL = resolveScript({
                scriptId: 'customscript_bbx_setup_oac_init',
                deploymentId: 'customdeploy_bbx_setup_oac_init',
                returnExternalUrl: false,
                params: { connectName: connectionName }
            });

            status = Status({ label: 'Not Connected', status: 'error' });
            nextTitle = 'Connect to Billabex';
            nextAction = `Please connect to Billabex by clicking the button below.
                ${Button({ label: 'Connect to Billabex', link: oacInitURL, variant: 'primary' })}`;
        }
        // Case 2: Connected but no organization selected
        else if (connection.isConnected() && !connection.hasOrganization()) {
            let orgsOptions = '';
            let errorMessage = '';

            try {
                const client = createClient(connectionName);
                const orgsResult = client.organizations.list();

                log.debug('setup.organizations', {
                    count: orgsResult.data.nodes.length,
                    rateLimit: orgsResult.rateLimit
                });

                if (orgsResult.data.nodes.length === 0) {
                    orgsOptions = '<option value="" disabled selected>No organizations available</option>';
                } else {
                    orgsOptions = '<option value="" disabled selected>Select an organization...</option>';
                    orgsOptions += orgsResult.data.nodes
                        .map(org => `<option value="${org.id}|${org.name}">${org.name} (${org.id})</option>`)
                        .join('');
                }
            } catch (e) {
                log.error('setup.organizations.error', { name: e.name, message: e.message });

                if (e instanceof TokenExpiredError) {
                    errorMessage = 'Access token expired. Please wait for the scheduled refresh (runs every 30 minutes).';
                    orgsOptions = '<option value="" disabled selected>Token expired</option>';
                } else {
                    errorMessage = `Error loading organizations: ${e.message}`;
                    orgsOptions = '<option value="" disabled selected>Error loading</option>';
                }
            }

            status = Status({ label: 'Organization not selected', status: 'warning' });
            nextTitle = 'Select Organization';

            let formContent = `
                ${Select({
                    label: 'Organization',
                    name: 'organizationId',
                    options: orgsOptions,
                    helpText: 'Select the organization to sync with NetSuite'
                })}
                <div class="pt-4">
                    ${SubmitButton({ label: 'Save', variant: 'primary' })}
                </div>
            `;

            if (errorMessage) {
                formContent = `
                    <div class="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">
                        ${errorMessage}
                    </div>
                    ${formContent}
                `;
            }

            nextAction = `<form method="POST" class="space-y-4">${formContent}</form>`;
        }
        // Case 3: Fully connected
        else if (connection.isConnected() && connection.hasOrganization()) {
            let orgName = context.request.parameters.orgName || '';
            const syncStarted = context.request.parameters.syncStarted === 'T';
            const syncError = context.request.parameters.syncError || '';

            if (!orgName) {
                try {
                    const client = createClient(connectionName);
                    const orgResult = client.organizations.get(connection.organizationId);
                    orgName = orgResult.data.name;
                } catch (e) {
                    log.error('setup.organization.get.error', { name: e.name, message: e.message });
                }
            }

            status = Status({ label: 'Connected', status: 'success' });
            nextTitle = 'Synchronization';

            let syncMessage = '';
            if (syncStarted) {
                syncMessage = `<div class="mb-4 rounded-xl bg-green-50 p-4 text-sm text-green-700">
                    Full synchronization has been started. This may take several minutes depending on the number of records.
                    Check the <strong>Map/Reduce Script Status</strong> page in NetSuite for progress.
                </div>`;
            }
            if (syncError) {
                syncMessage = `<div class="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">
                    Failed to start synchronization: ${syncError}
                </div>`;
            }

            const orgInfo = orgName
                ? `<p class="text-[#003049]/70">Your NetSuite account is connected to Billabex and ready to sync.</p>
                    <p class="mt-3 text-sm text-[#003049]/50">Organization: <strong class="text-[#003049]/80">${orgName}</strong> (${connection.organizationId})</p>`
                : `<p class="text-[#003049]/70">Your NetSuite account is connected to Billabex and ready to sync.</p>
                    <p class="mt-3 text-sm text-[#003049]/50">Organization ID: <code class="rounded bg-[#003049]/5 px-2 py-1 font-mono text-xs">${connection.organizationId}</code></p>`;

            nextAction = `
                ${orgInfo}
                ${syncMessage}
                <form method="POST" class="mt-6">
                    <input type="hidden" name="action" value="full_sync">
                    ${SubmitButton({ label: 'Run Full Sync', variant: 'primary' })}
                    <p class="mt-2 text-xs text-[#003049]/40">Syncs all customers with unpaid invoices and credit memos to Billabex. Can be used at any time for reconciliation.</p>
                </form>
            `;
        }

        // Render page
        const htmlFile = layout({
            title: 'Setup',
            content: render({
                file: 'setup.html',
                slots: { status, nextAction, nextTitle }
            })
        });

        context.response.write(htmlFile);
    }

    return { onRequest }
});
