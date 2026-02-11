# Pull Request Format

## Title

Conventional Commits format: `type(scope): subject`

- type: lowercase (feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert, release)
- scope: optional
- subject: lowercase imperative verb, no period, max 100 chars

Examples:

- feat: add invoice status reconciliation
- fix(api): resolve race condition in email scheduling

## Description

Summarize the changes from the diff:

- List key modifications (files, components, functions)
- Note any breaking changes or API modifications
- Keep it concise: 3-5 bullets max

Do not include sections that require human input (testing done, motivation, etc.)
