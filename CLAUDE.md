# durhack-2026

A browser simulation of trains that coordinate without a control centre. Built by four people in 24 hours for the Neptune North challenge at DurHack.

The design is the agreed contract. Read it before writing code.

@docs/design.md

## Before starting a task

1. Run `git switch main && git pull`.
2. Run `gh issue list` and read your issue with `gh issue view <number>`.
3. Create a branch named `yourname/short-task`.

## While working

- Stay inside the folders your issue lists. The folder table is in the design.
- A train agent uses only the input passed to `decide`. It never reads another train's state or the engine's internals.
- Use metres, seconds and metres per second everywhere.
- Take constants from `src/shared/constants.ts`. Do not hardcode numbers the design names.
- Add a test for each rule you implement.

## Changing the contract

`docs/design.md` and everything in `src/shared/` are shared by all four people. Change them in a pull request that touches nothing else, and tell the team before merging.

## Team decisions

A choice that affects all four people needs the whole team's agreement before it goes into the docs or the code. Examples are the stack, the map, the shared types and these working rules.

1. Open an issue with the `decision` label. State the proposal, the alternatives and what it blocks.
2. Comment on any issue the decision blocks.
3. Wait until all four members have commented their agreement on the issue. The members are 3vyo, 5ome1n3, IsaB31224 and ndlyyyyy.
4. Close the issue, then update the docs or the repo through a pull request.

Do not write an unagreed choice into `docs/design.md`, `CLAUDE.md` or `src/shared/` as if it were settled. Choices inside your own issue's folders are yours to make.

Run `gh issue list --label decision` to see what is waiting on the team.

## Finishing a task

1. Push the branch and open a pull request with `gh pr create`.
2. Put `Closes #<number>` in the description.
3. Squash merge once tests pass. Keep pull requests small and merge often.
4. Comment on the issue if you are blocked or if you leave work unfinished.

Never push to `main` directly. The repo is private on a free plan, so GitHub does not enforce this.

## Stack

TypeScript, Vite, a canvas, and Vitest. No server. The engine issue adds the scaffold and the npm scripts.
