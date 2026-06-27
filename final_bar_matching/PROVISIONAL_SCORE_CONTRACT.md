# Provisional Full-Score Contract

This is a draft adapter contract for Milestone 2. It is not a claim that a completed real parser exists in the repository.

## Sample Fields Consumed

- `scoreId`
- `title`
- `pages`
- `pageId`
- `pageIndex`
- `pageNumber`
- `duration`
- `bars` or `measures`
- `barId` or `measureId`
- `barIndex` or `measureIndex`
- `startTime`
- `events` or `chords`
- `eventId` or `chordId`
- `time` or `scoreTime`
- `notes`
- `midi`
- `note`
- `dur` or `duration`
- `hand`

## Generated Internal Fields

- Missing `scoreId` defaults to `score-1`.
- Missing page IDs become `page-{pageNumber}`.
- Missing bar IDs become `{pageId}-bar-{barIndex + 1}`.
- Missing event IDs become `{barId}-event-{eventIndex + 1}`.
- Missing note IDs become `{eventId}-note-{noteIndex + 1}`.
- `eventIndex`, `barIndex`, and `pageIndex` are normalized to zero-based indexes when absent.
- `midi` arrays on events are deduplicated and sorted.

## Provisional Assumptions

- Bars are normalized only when the sample explicitly supplies `bars` or `measures`.
- No bars are synthesized from timing values.
- Explicit `events` or `chords` are preserved as event boundaries.
- If a bar supplies individual `notes` instead of events/chords, simultaneous notes are grouped using the configured tolerance.
- Note names use scientific pitch notation such as `C4`, `D#5`, or `Bb3`.
- Time values are seconds within the local page/bar context until the real parser contract says otherwise.

## Adapter To Update Later

Update `score_normalizer.js` when the real parser is completed. Parser-specific field mapping should stay inside that file so the future score-progress tracker can consume only the stable normalized structure.
