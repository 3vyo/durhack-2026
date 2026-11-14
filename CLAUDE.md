# durhack-2026

A browser simulation of trains that coordinate without a control centre. Built by four people in 24 hours for the Neptune North challenge at DurHack.

The design is the agreed contract. Read it before writing code.

@docs/design.md

## Before starting a task

1. Run `git switch main && git pull`.
2. Create a branch named `yourname/short-task`.

Issues are optional. Open one with `gh issue create` when it helps, for example to ask the team a question or to say what you are working on. Run `gh issue list` to see what is open.

## While working

- Stay inside the folders for your part of the build. The folder table is in the design.
- A train agent uses only the input passed to `decide`. It never reads another train's state or the engine's internals.
- Use metres, seconds and metres per second everywhere.
- Take constants from `src/shared/constants.ts`. Do not hardcode numbers the design names.
- Add a test for each rule you implement.

## Changing the contract

`docs/design.md` and everything in `src/shared/` are shared by all four people. Change them in a pull request that touches nothing else, and tell the team before merging.

## Finishing a task

1. Push the branch and open a pull request with `gh pr create`.
2. If the work has an issue, put `Closes #<number>` in the description.
3. Squash merge once tests pass. Keep pull requests small and merge often.
4. Tell the team if you are blocked or if you leave work unfinished.

Never push to `main` directly. The repo is private on a free plan, so GitHub does not enforce this.

## Stack

TypeScript, Vite, a canvas, and Vitest. No server. The engine work adds the scaffold and the npm scripts.
