# Commit Message Format

Generate commit messages following Conventional Commits.

## Format

```
type(scope): subject

[optional body]

[optional footer]
```

## Rules (enforced by commitlint)

- **Header**: max 100 characters total
- **Type**: required, lowercase
- **Scope**: optional, in parentheses
- **Subject**: required, no period at end, no capital start
- **Body**: blank line after header, max 100 chars/line
- **Footer**: blank line before, max 100 chars/line

## Allowed Types

| Type     | Description                              |
| -------- | ---------------------------------------- |
| feat     | New feature                              |
| fix      | Bug fix                                  |
| docs     | Documentation only                       |
| style    | Formatting, whitespace (no code change)  |
| refactor | Code change without fix or feature       |
| perf     | Performance improvement                  |
| test     | Add or fix tests                         |
| build    | Build system or dependencies             |
| ci       | CI configuration                         |
| chore    | Other changes (no src/test modification) |
| revert   | Revert a previous commit                 |
| release  | Version release                          |

## Subject Guidelines

- Use imperative mood: "add", "fix", "update" (not "added", "fixes")
- Start with lowercase letter
- No period at the end
- Be specific and concise

## Examples

Good:

```
feat: add user authentication endpoint
fix: resolve race condition in invoice sync
refactor(api): simplify aggregate event handling
test: add organization factory tests
docs: update installation instructions
chore(deps): bump typescript to 5.9
```

Bad:

```
Added new feature       → feat: add new feature
Fix bug.                → fix: resolve null pointer in handler
FEAT: Add feature       → feat: add feature
feat:add feature        → feat: add feature (space after colon)
```

## Body and Footer

Body (optional):

- Explain what and why, not how
- Wrap at 100 characters

Footer (optional):

- Breaking changes: `BREAKING CHANGE: description`
- Issue references: `closes #123`, `fixes #456`
