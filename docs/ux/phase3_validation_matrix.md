# Phase 3 Validation Matrix

## Purpose

Validate the UX improvements against core scenarios and capture pass/fail evidence consistently.

## Test Setup

- Browser: Chrome stable
- Extension: unpacked from `plugin/src/chrome-extension`
- Pages:
  - supported PR files page
  - supported commit page
  - unsupported GitHub page
  - non-GitHub page

## Scenario Matrix

| ID | Scenario | Expected popup status | Expected badge | Expected in-page behavior | Result |
|---|---|---|---|---|---|
| S1 | Supported PR success with moved blocks | `Success`, block count > 0 | numeric count | button shows found state, markers visible, jump works | TODO |
| S2 | Supported PR success with 0 blocks | `No blocks found` | `0` | in-page no-result message visible | TODO |
| S3 | Unsupported page | `Not supported page` | no badge | no detection trigger side effects | TODO |
| S4 | Disabled by settings (`min < 0`) | `Disabled by settings` | no badge | in-page message indicates disabled state | TODO |
| S5 | Diff download failure (`diff_download`) | error with readable title | `!` red | in-page retry/error message | TODO |
| S6 | Server connect failure (`server_request/server_connect`) | error with phase details | `!` red | in-page retry/error message | TODO |
| S7 | Server HTTP error (`server_response/server_http_error`) | error with readable title | `!` red | in-page retry/error message | TODO |
| S8 | Invalid payload (`server_response/server_invalid_payload`) | error with readable title | `!` red | in-page retry/error message | TODO |
| S9 | Render DOM lookup failure (`render/render_dom_lookup`) | error with readable title | `!` red | inline render-failure guidance | TODO |
| S10 | Render apply failure (`render/render_apply`) | error with readable title | `!` red | inline render-failure guidance | TODO |

## Accessibility Checklist

- [ ] Keyboard-only access to popup controls
- [ ] Visible focus ring on all interactive elements
- [ ] Color contrast acceptable for status and error text
- [ ] Error section is understandable without color-only cues
- [ ] Technical details disclosure is keyboard accessible
- [ ] Popup remains usable at 125% and 150% zoom

## Evidence Log

Use this section while testing:

- Date:
- Tester:
- Extension commit:
- Notes:
  - S1:
  - S2:
  - S3:
  - S4:
  - S5:
  - S6:
  - S7:
  - S8:
  - S9:
  - S10:
