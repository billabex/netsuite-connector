# Contributing to Billabex NetSuite Connector

Thank you for your interest in contributing to the Billabex NetSuite Connector! This document provides guidelines and instructions for contributing.

## Code of Conduct

Please be respectful and constructive in all interactions. We welcome contributors of all experience levels.

## How to Contribute

### Reporting Bugs

1. Check if the issue already exists in [GitHub Issues](https://github.com/billabex/netsuite-connector/issues)
2. If not, create a new issue using the **Bug Report** template
3. Include:
   - NetSuite version and environment (sandbox/production)
   - Steps to reproduce
   - Expected vs actual behavior
   - Relevant logs from the Billabex Sync Log custom record

### Suggesting Features

1. Open an issue using the **Feature Request** template
2. Describe the use case and expected behavior
3. If possible, outline how it might be implemented

### Submitting Code

#### Prerequisites

- Node.js 18+
- pnpm
- SuiteCloud CLI configured with a NetSuite sandbox account
- Familiarity with SuiteScript 2.1

#### Development Workflow

1. **Fork** the repository
2. **Clone** your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/netsuite-connector.git
   cd netsuite-connector
   ```
3. **Install** dependencies:
   ```bash
   pnpm install
   ```
4. **Create a branch** for your changes:
   ```bash
   git checkout -b feat/your-feature-name
   ```
5. **Make your changes** following the coding standards below
6. **Test** your changes in a NetSuite sandbox
7. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/):
   ```bash
   git commit -m "feat: add support for vendor bills"
   ```
8. **Push** to your fork:
   ```bash
   git push origin feat/your-feature-name
   ```
9. **Open a Pull Request** against `main`

## Coding Standards

### SuiteScript Guidelines

- Use **SuiteScript 2.1** module syntax
- Add JSDoc comments for all exported functions
- Include the standard NetSuite JSDoc header:
  ```javascript
  /**
   * @NApiVersion 2.1
   * @NScriptType UserEventScript
   * @NModuleScope SameAccount
   */
  ```

### Code Style

- Use **4 spaces** for indentation (NetSuite convention)
- Use **single quotes** for strings
- Use **const** by default, **let** when reassignment is needed
- Avoid **var**

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): subject

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`

Examples:
- `feat: add support for sales orders`
- `fix(sync): handle null customer email`
- `docs: update OAuth setup instructions`

### Pull Request Guidelines

- Keep PRs focused on a single feature or fix
- Update the README if adding new features
- Ensure no sensitive data (tokens, emails, account IDs) is committed
- Test in a NetSuite sandbox before submitting

## Project Structure

```
src/
├── FileCabinet/SuiteScripts/billabex/
│   ├── libs/           # Shared modules (API client, sync logic, etc.)
│   ├── ue_*.js         # UserEvent scripts
│   ├── *_sync.js       # Scheduled/MapReduce scripts
│   └── setup*.js       # OAuth setup Suitelets
└── Objects/            # SDF custom object definitions (XML)
```

### Key Files

| File | Purpose |
|------|---------|
| `libs/config.js` | Centralized configuration |
| `libs/billabex-api.js` | API client with rate limiting |
| `libs/sync.js` | Synchronization logic |
| `libs/connection.js` | OAuth connection management |

## Testing

### Local Validation

```bash
pnpm suitecloud project:validate
```

### Deploying to Sandbox

```bash
pnpm suitecloud project:deploy
```

### Manual Testing Checklist

Before submitting a PR, verify:

- [ ] Customer create/update/delete syncs correctly
- [ ] Contact create/update/delete syncs correctly
- [ ] Invoice sync includes PDF attachment
- [ ] Credit memo sync includes PDF attachment
- [ ] Payment updates invoice `paidAmount`
- [ ] Token refresh works (wait 30 min or manually trigger)
- [ ] Failed operations are queued for retry

## Getting Help

- **Documentation**: Check the [README](README.md) first
- **Issues**: Search [existing issues](https://github.com/billabex/netsuite-connector/issues)
- **Discussions**: Open a [GitHub Discussion](https://github.com/billabex/netsuite-connector/discussions) for questions
- **Email**: [support@billabex.com](mailto:support@billabex.com)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
