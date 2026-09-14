# Working on Path

Start at [AGENTS.md](../AGENTS.md). This folder holds the maintained project context for people and coding agents; it is not application runtime configuration.

| Need                                 | Read                                                            |
| ------------------------------------ | --------------------------------------------------------------- |
| Required coding and change rules     | [Engineering contract](instructions/engineering.md)             |
| Where code and styles belong         | [Architecture and ownership](architecture.md)                   |
| Hooks, contexts and shared state     | [Renderer state ownership](instructions/state-management.md)    |
| Which checks to run                  | [Verification](instructions/verification.md)                    |
| A bounded implementation task        | [Implementation prompt](prompts/implement.md)                   |
| An evidence-based review             | [Review prompt](prompts/review.md)                              |
| Current capabilities and limitations | [Current state](memory-bank/current-state.md)                   |
| Reasons behind durable choices       | [Decisions](memory-bank/decisions.md)                           |
| Recording and document behavior      | [Recording workflow specification](specs/recording-workflow.md) |

Instructions define rules, specifications define observable behavior, and memory records the current state and its rationale. Prompts reference those sources instead of duplicating them. When a change affects one of these facts, update its owner in the same change. Keep entries concise, source-linked, and safe to publish: no credentials, personal paths, private recordings, transcripts, or chat histories.

Create a new specification only for an actual requested behavior. Record its status, scope, acceptance criteria, compatibility effects, and verification. A proposed specification is not evidence that its behavior exists. Add a decision only when its rationale is useful beyond the immediate change.
