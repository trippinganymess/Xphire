# CodeX Automation & Task Execution Protocol
Activation Mode: Always On

# Guardrails
NEVER execute destructive terminal commands (e.g., rm -rf /, git reset --hard) without explicit user confirmation.

ALWAYS run code quality, linting, and type-checking scripts before finalizing any code modification task.

Workflow Steps
1. When instructed to implement code changes, refactor, or build a feature:
2. Parse requirement specifications and create a dynamic step-by-step execution plan using the plan_task tool.
3. Locate and analyze target codebase files using file system context tools before modifying any logic.
4. Write modular, type-safe code while maintaining existing repository styling and architectural patterns.
5. Execute unit test suites and code-linting checks via workspace terminal integration to verify functionality.
6. Generate a comprehensive summary detailing modified files, introduced functions, and test run results upon completing the task.
