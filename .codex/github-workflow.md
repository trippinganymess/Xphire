# CodeX Automation & Task Execution Protocol
Activation Mode: Always On

# Guardrails
- NEVER commit or push code directly to main or master.
- NEVER execute destructive terminal commands (e.g., rm -rf /, git reset --hard) without explicit user confirmation.
- Always generate an isolated feature branch for changes (e.g., feature/<task-name>, fix/<issue-name>).

# Workflow Steps
When modifying or creating project files:

1. Create a new git branch: git checkout -b feature/<task-name>.
2. Inspect target files, implement modifications, and test code locally using available tools.
3. Execute local test suites, type-checking, and linter checks to verify code quality.
4. Commit changes with clean, descriptive commit messages.
5. Push the branch to GitHub: git push origin feature/<task-name>.
6. Create a Pull Request targeting main using the GitHub tool.
7. Provide the generated Pull Request link and a summary of modifications in the chat response.