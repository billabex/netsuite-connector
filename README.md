# Billabex Connector for NetSuite

A complete **SuiteScript 2.1** integration between Oracle NetSuite and the [Billabex](https://billabex.com) platform for automated accounts receivable management.

## Features

- **OAuth2 + PKCE** authentication with automatic token refresh
- **Real-time synchronization** via UserEvent scripts
- **Full sync** via MapReduce for initial data migration
- **Retry queue** for failed operations with automatic recovery
- **Bidirectional delete propagation**
- **PDF document attachment** for invoices and credit memos

## Architecture

```
src/
├── FileCabinet/SuiteScripts/billabex/
│   ├── libs/                      # Shared modules
│   │   ├── billabex-api.js        # API client with rate limiting & auto-retry
│   │   ├── config.js              # Centralized configuration
│   │   ├── connection.js          # OAuth connection management
│   │   ├── sync.js                # Synchronization logic
│   │   ├── oauth.js               # OAuth helpers (PKCE, token exchange)
│   │   ├── jwt.js                 # JWT decoding utilities
│   │   ├── components.js          # UI component helpers
│   │   ├── template.js            # HTML templating
│   │   └── templates/             # Suitelet HTML templates
│   ├── setup.js                   # Setup Suitelet (main UI)
│   ├── setup_oac_init.js          # OAuth flow initiation
│   ├── setup_oac_callback.js      # OAuth callback handler
│   ├── refresh_tokens.js          # Scheduled token refresh (every 30 min)
│   ├── full_sync.js               # MapReduce full synchronization
│   ├── process_sync_queue.js      # Retry queue processor
│   ├── cleanup_logs.js            # Log cleanup (30+ days)
│   ├── ue_customer.js             # Customer sync (create/update/delete)
│   ├── ue_contact.js              # Contact sync (create/update/delete)
│   ├── ue_invoice.js              # Invoice sync (create/update/delete)
│   ├── ue_credit_memo.js          # Credit memo sync (create/update/delete)
│   └── ue_customer_payment.js     # Payment sync (updates invoice paidAmount)
└── Objects/                       # SDF custom objects (XML definitions)
```

## Synchronized Entities

| NetSuite | Billabex | Direction |
|----------|----------|-----------|
| Customer | Account | NS → BBX |
| Contact | Contact | NS → BBX |
| Invoice | Invoice | NS → BBX |
| Credit Memo | Credit Note | NS → BBX |
| Customer Payment | Invoice.paidAmount | NS → BBX |

## Prerequisites

### NetSuite Requirements

- NetSuite account with **SuiteScript 2.1** support
- **Administrator** role (or custom role with required permissions)
- Features enabled:
  - Custom Records
  - Server-Side Scripting
  - SuiteCloud Development Framework (SDF)

### Billabex Requirements

- Active Billabex organization

### Development Tools

- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/) (recommended) or npm
- [SuiteCloud CLI](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_1558708800.html)

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/billabex/netsuite-connector.git
cd netsuite-connector
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure SuiteCloud CLI

Create a `project.json` file (gitignored) with your NetSuite account credentials:

```bash
suitecloud account:setup
```

This will prompt you for:

- Account ID
- Authentication method (OAuth 2.0 recommended)
- Role

### 4. Configure the connector

Edit `src/FileCabinet/SuiteScripts/billabex/libs/config.js`:

```javascript
// API endpoint (production by default)
const BASE_URL = 'https://next.billabex.com';

// Set to true for testing (redirects all emails)
const SANDBOX_MODE = false;

// Override email for sandbox testing
const OVERRIDE_EMAIL = 'your-test-email@example.com';

// Default language for contacts
const DEFAULT_LANGUAGE = 'fr';
```

### 5. Deploy to NetSuite

```bash
pnpm suitecloud project:deploy
```

This will:

1. Run unit tests (if any)
2. Deploy all scripts and custom objects to your NetSuite account

## Configuration

### Custom Records Created

| Record | Script ID | Purpose |
|--------|-----------|---------|
| Billabex Connection | `customrecord_bbx_cx` | Stores OAuth credentials and tokens |
| Sync Log | `customrecord_bbx_sync_log` | Operation logs for debugging |
| Sync Queue | `customrecord_bbx_sync_queue` | Failed operations retry queue |

### Custom Fields Created

| Field | Script ID | Applied To |
|-------|-----------|------------|
| Billabex ID | `custentity_bbx_id` | Customer |
| Billabex Contact ID | `custentity_bbx_contact_id` | Contact |
| Billabex Invoice ID | `custbody_bbx_invoice_id` | Invoice |
| Billabex Credit Memo ID | `custbody_bbx_credit_memo_id` | Credit Memo |

### Scheduled Scripts

| Script | Frequency | Purpose |
|--------|-----------|---------|
| Token Refresh | Every 30 minutes | Refreshes OAuth access tokens before expiration |
| Process Queue | Every 15 minutes | Retries failed sync operations |
| Cleanup Logs | Daily | Removes logs older than 30 days |

## OAuth Setup

1. Navigate to **Customization > Scripting > Scripts**
2. Find and deploy the **Billabex Setup** Suitelet
3. Open the Suitelet URL
4. Enter your Billabex **Registration Token**
5. Click **Connect** to initiate the OAuth flow
6. Authorize the connection in Billabex
7. You'll be redirected back to NetSuite with a success message

The connector will automatically:

- Register as an OAuth client with Billabex
- Exchange the authorization code for tokens
- Store tokens securely in the Connection record
- Schedule automatic token refresh

## Synchronization

### Real-time Sync

UserEvent scripts trigger on record changes:

- **afterSubmit** (create/edit): Syncs the record to Billabex
- **afterSubmit** (delete): Removes the record from Billabex

### Full Sync (MapReduce)

For initial data migration or resync:

1. Navigate to **Customization > Scripting > Script Deployments**
2. Find **Billabex Full Sync**
3. Click **Execute**

The MapReduce job will:

1. **getInputData**: Query all customers with open invoices
2. **map**: Sync each customer, contacts, invoices, and credit memos
3. **summarize**: Log results and errors

### Retry Queue

Failed operations are automatically queued for retry:

- Network errors
- Rate limiting (429)
- Temporary API errors (5xx)

The queue processor runs every 15 minutes and retries with exponential backoff.

## Error Handling

### 401 Unauthorized

The API client automatically:

1. Detects expired tokens
2. Reloads the connection from the database
3. Retries the request with fresh tokens

### 404 Not Found (Orphan IDs)

If a Billabex ID stored in NetSuite no longer exists:

1. The ID field is cleared
2. The record is recreated in Billabex
3. The new ID is stored

### Rate Limiting

The API client respects `Retry-After` headers and implements exponential backoff.

## Customization

### Adding Custom Fields

To sync additional fields, modify `libs/sync.js`:

```javascript
// In syncAccount()
const payload = {
    name: customer.getValue('companyname'),
    // Add your custom field
    customField: customer.getValue('custentity_your_field')
};
```

### Filtering Records

To exclude certain records from sync, add conditions in the sync functions:

```javascript
// In syncInvoice()
if (invoice.getValue('custbody_exclude_from_sync')) {
    log.debug('Skipping excluded invoice', invoiceId);
    return null;
}
```

## API Reference

The Billabex Public API documentation is available at:

- **OpenAPI Spec**: <https://next.billabex.com/api/docs/public-yaml>
- **Developer Portal**: <https://developer.billabex.com>

## Development

### Project Structure

```
netsuite-connector/
├── src/                    # SDF project source
│   ├── FileCabinet/        # SuiteScripts
│   ├── Objects/            # Custom objects (XML)
│   ├── deploy.xml          # Deployment manifest
│   └── manifest.xml        # Project manifest
├── __tests__/              # Jest unit tests
├── package.json
├── suitecloud.config.js    # SuiteCloud CLI config
└── jest.config.js
```

### Running Tests

```bash
pnpm test
```

### Validating the Project

```bash
pnpm suitecloud project:validate
```

## Troubleshooting

### Common Issues

**"INVALID_LOGIN" during deployment**

- Run `suitecloud account:setup` to reconfigure authentication

**"SSS_MISSING_REQD_ARGUMENT" errors**

- Check that all custom fields are deployed
- Verify the custom record exists

**Sync not triggering**

- Verify UserEvent script deployments are active
- Check script execution logs in NetSuite

### Viewing Logs

1. Navigate to **Customization > Lists, Records, & Fields > Record Types**
2. Find **Billabex Sync Log**
3. Click **List** to view recent operations

## License

MIT License - See [LICENSE](LICENSE) for details.

## Support

- **Issues**: <https://github.com/billabex/netsuite-connector/issues>
- **Documentation**: <https://docs.billabex.com>
- **Contact**: <support@billabex.com>
