# Git & Pull Request Protocol

Activation Mode: Always On

## Guardrails
- NEVER commit or push code directly to `main` or `master`.
- Always generate an isolated feature branch for changes (e.g., `feature/m3-ui-dashboard`, `fix/artifact-parser`).

## Workflow Steps
When modifying or creating project files:
1. Create a new git branch: `git checkout -b feature/<task-name>`.
2. Write and test the frontend code locally using Playwright MCP.
3. Commit changes with clean commit messages.
4. Push the branch to GitHub: `git push origin feature/<task-name>`.
5. Create a Pull Request targeting `main` using the GitHub MCP tool.
6. Provide the generated Pull Request link in the chat response.