# UX Follow-up Backlog

This backlog captures post-implementation UX refinements discovered during review and validation.

## P0

### 1. Preserve popup edits across refresh reliably
- **User problem**: editing settings can feel unstable if state refreshes while typing.
- **UX change**: keep explicit `Unsaved changes` state and never overwrite input while dirty.
- **Technical touchpoints**: `plugin/src/chrome-extension/popup.js`
- **Success metric**: 0 observed input reset events across 20 edits.
- **QA checklist**:
  - [ ] change value and wait 10s without losing input
  - [ ] save updates state to `Saved`

### 2. Error CTA clarity and reliability
- **User problem**: users need one-click recovery from failures.
- **UX change**: ensure Retry/Open/Copy diagnostics always work and show clear feedback.
- **Technical touchpoints**: `popup.js`, `contentScript.js`
- **Success metric**: all error scenarios expose at least one successful recovery path.
- **QA checklist**:
  - [ ] Retry triggers run on supported pages
  - [ ] Copy diagnostics always returns explicit result message

## P1

### 3. Stronger in-page legend discoverability
- **User problem**: some users miss what marker bars represent.
- **UX change**: make legend more prominent on first success and collapsible afterward.
- **Technical touchpoints**: `contentScript.js`, `style.css`
- **Success metric**: lower “what does this mean?” feedback in usability sessions.
- **QA checklist**:
  - [ ] first-run hint appears once
  - [ ] legend remains accessible but unobtrusive

### 4. Human-readable marker tooltips
- **User problem**: technical score text can be hard to parse quickly.
- **UX change**: keep plain-language tooltip with optional advanced details.
- **Technical touchpoints**: `contentScript.js`
- **Success metric**: users describe tooltip meaning correctly in first read.
- **QA checklist**:
  - [ ] tooltip explains action and purpose
  - [ ] does not overwhelm with implementation details

### 5. Consistent state language between popup and page
- **User problem**: different wording between popup and in-page controls causes confusion.
- **UX change**: unify status vocabulary (`Running`, `Found`, `No blocks`, `Error`).
- **Technical touchpoints**: `popup.js`, `contentScript.js`
- **Success metric**: no conflicting status terms in UX copy audit.
- **QA checklist**:
  - [ ] terms match across popup, badge, and in-page status text

## P2

### 6. Optional compact mode for popup
- **User problem**: advanced users may want a denser popup.
- **UX change**: add compact mode toggle in settings.
- **Technical touchpoints**: `popup.html`, `popup.css`, `popup.js`
- **Success metric**: reduced popup scrolling while preserving readability.
- **QA checklist**:
  - [ ] compact mode toggles without layout break
  - [ ] controls remain keyboard accessible

### 7. Context-aware unsupported page guidance
- **User problem**: unsupported page message should guide to exactly where to go.
- **UX change**: provide actionable link/path hint to PR files view.
- **Technical touchpoints**: `popup.js`, `background.js`
- **Success metric**: faster recovery from unsupported state.
- **QA checklist**:
  - [ ] unsupported state includes explicit next-step guidance
