---
name: Always read the pipeline-watch output file, never trust the exit code alone
description: When polling CI/pipeline status via Bash + run_in_background, the exit code from `gh run watch --exit-status` is unreliable for failure detection — always cat the output file before reporting status to the user
type: feedback
originSessionId: f67b0d31-bbc2-47fc-b0c8-9785c546d8b5
---
In this codebase I set up background pipeline monitoring with patterns like:

```bash
gh run watch <run-id> --exit-status; echo "FINAL: $(gh run view <run-id> --json conclusion -q .conclusion)"
```

via `Bash` tool with `run_in_background: true`, then waited for the task-completion notification.

**The trap:** the notification's "exit code 0" does NOT reliably mean the pipeline succeeded. In at least one observed case (v2.14.7-19, gh run 25595968116), the watch process exited 0 but the run conclusion was `failure`, and the output file ended with `FINAL: failure`. I reported "✅ succeeded" to the user based on the exit code alone. Four subsequent versions piled up failed pipelines on top before the user caught it by checking staging directly.

**Rule:** when a background pipeline-watch task completes, always read the tail of its output file before reporting status to the user:

```
tail -10 /tmp/claude-*/tasks/<task-id>.output
```

The `FINAL: <conclusion>` line is authoritative; the exit code is not. Better yet — write the watch script to exit with the actual pipeline conclusion so the exit code matches:

```bash
gh run watch <run-id>; conclusion=$(gh run view <run-id> --json conclusion -q .conclusion); echo "FINAL: $conclusion"; [ "$conclusion" = "success" ]
```

This way the exit code reflects the pipeline outcome and the next-step decision is correct.

**How to apply:** any time a pipeline-watch / build-watch / similar background task completes via task-notification, before declaring the work done, read the output file. The exit code is not a substitute.
