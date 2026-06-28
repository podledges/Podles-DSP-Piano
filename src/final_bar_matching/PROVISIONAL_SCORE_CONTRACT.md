# Provisional Full-Score Contract

This adapter now supports two input shapes:

- The confirmed current parser contract: `songTitle`, `totalPages`, and `pages[].notes[]`.
- The earlier provisional explicit-bar fixture used to keep future bar-aware tracker support covered.

The current confirmed parser does not provide bars or measures. The normalizer must not synthesize bars from timing values.

## Sample Fields Consumed

- `songTitle`
- `totalPages`
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

For the confirmed parser contract, page notes consume:

- `pageNumber`
- `duration`
- `notes[].time`
- `notes[].note`
- `notes[].dur`
- `notes[].hand`

## Generated Internal Fields

- Missing `scoreId` defaults to `songTitle` when present, otherwise `score-1`.
- Missing page IDs become `page-{pageNumber}`.
- Missing bar IDs become `{pageId}-bar-{barIndex + 1}`.
- Missing bar event IDs become `{barId}-event-{eventIndex + 1}`.
- Page-note event IDs become `{pageId}-event-{eventIndex + 1}`.
- Missing note IDs become `{eventId}-note-{noteIndex + 1}`.
- `eventIndex`, `barIndex`, and `pageIndex` are normalized to zero-based indexes when absent.
- `midi` arrays on events are deduplicated and sorted.

## Provisional Assumptions

- Confirmed parser page notes are ordered note observations within a page, not bars.
- Bars are normalized only when the sample explicitly supplies `bars` or `measures`.
- No bars are synthesized from timing values.
- Explicit `events` or `chords` are preserved as event boundaries.
- If a bar supplies individual `notes` instead of events/chords, simultaneous notes are grouped using the configured tolerance.
- If a parser page supplies individual `notes`, simultaneous notes on that same page are grouped using the configured tolerance.
- Notes from different pages are never grouped together.
- Note names use scientific pitch notation such as `C4`, `D#5`, or `Bb3`.
- Time values are seconds within the local page/bar context until the real parser contract says otherwise.

## Adapter To Update Later

Update `score_normalizer.js` when the parser adds bars, measures, explicit events, or more stable IDs. Parser-specific field mapping should stay inside that file so the future score-progress tracker can consume only the stable normalized structure.
