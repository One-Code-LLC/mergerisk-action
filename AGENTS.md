# Agent instructions

<!-- PROJECT_STATUS_TRACKER_INSTRUCTIONS_START -->
## Project status tracker

- Treat the root `.project-status.json` as the canonical portfolio summary for this repository.
- Update it in the same change whenever the project status, roadmap outcome, stage list, or current stage changes.
- Keep `schemaVersion` at `1`. Keep `roadmap.currentStage` as a one-based index into the ordered `roadmap.stages` array.
- Preserve stable stage `id` values after they are introduced. Change the stage order or roadmap outcome only when the actual roadmap changes.
- When work advances to another stage, update `roadmap.currentStage`. When the final stage is finished, set `status` to `complete` and leave `currentStage` pointing at the final stage.
- Use `status` values only from `in-progress`, `planned`, `paused`, `complete`, or `archived`.
- GitHub issue and pull-request counts are derived by the dashboard; never store those counts in the tracker. Use an optional stage `githubMilestone` only when that milestone really exists.
- If `reviewed` is `false`, inspect the repository's authoritative roadmap and current-status documentation, replace the generated placeholder data, and set `reviewed` to `true`. Do not invent roadmap stages or outcomes when authority is unclear.
<!-- PROJECT_STATUS_TRACKER_INSTRUCTIONS_END -->
