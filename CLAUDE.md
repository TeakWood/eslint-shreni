# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

## Build & Test

_Add your build and test commands here_

```bash
# Example:
# npm install
# npm test
```

## Architecture Overview

_Add a brief overview of your project architecture_

## Conventions & Patterns

_Add your project-specific conventions here_

<!-- shreni:begin kshetra v1 -->

## Shreni

This project is a Kshetra: Shreni's worker picks up its tasks and implements them
with its agents.

If your instructions give you a Shreni agent role for a task (Silpi, Viharapala or
another), this section does not apply to you: do the job you were given. The rules
below are for interactive sessions, which file work and do not do it.

    shreni task create --title "…"   # lands as proposed; the developer approves it
    shreni task ready / show / list  # read the queue
    shreni task remember "…"         # an insight for later sessions

Never, in an interactive session:

- `shreni task claim` or `shreni task finish`: the worker claims and finishes tasks.
- `git checkout -b`: the worker owns every task branch.
- `shreni task approve` or `shreni task upgrade`: those are the developer's.

Useful: `shreni status --all`, `shreni agents`, `shreni logs --kshetra <id>`,
`shreni pause --kshetra <id>`, `shreni resume --kshetra <id>`.

### Toolchain config sync

Shreni runs build, test and lint from the pointers in `.shreni/kshetra.yaml`.
When you add or change a toolchain config, update the matching pointer in the
same change: `stack.buildCommand`, `stack.testRunner`, `stack.lintCommand`.
<!-- shreni:end -->
