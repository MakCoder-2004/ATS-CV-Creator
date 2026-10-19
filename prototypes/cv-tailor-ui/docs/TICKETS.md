# Published implementation tickets

The user approved all 22 vertical slices and blocking edges. They are published as native sub-issues of [specification #1](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/1), each labeled `ready-for-agent`, with native GitHub blocked-by relationships.

This is a navigation index, **not a second task tracker**. GitHub is authoritative for current status, blockers, acceptance criteria and assignment. The table records the verified publication snapshot. The parent specification's body, title, state, labels and comments were not changed.

## Frontier at publication

- Start with **[#2 — Install and reopen the Workbench](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/2)**.
- Once #2 is completed, **#3 (identity/skills), #8 (saved jobs), and #9 (secure Gemini settings)** can proceed independently.
- Work any ticket whose native blockers are complete; do not infer that numeric issue order is a fully serial implementation plan.
- Production implementation has not started. No prototype commit/push or live provider call was performed by ticket publication.

## Ticket index

`Txx` is the approved proposal identifier. Blockers below are **actual GitHub issue numbers**, not proposal IDs.

| Slice | GitHub issue | Direct blocking issues |
| --- | --- | --- |
| T01 | [#2 — Install and reopen the Workbench](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/2) | None |
| T02 | [#3 — Manage local identity and skill evidence](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/3) | #2 |
| T03 | [#4 — Manage experience and project evidence](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/4) | #3 |
| T04 | [#5 — Complete the comprehensive profile](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/5) | #3 |
| T05 | [#6 — Review the one-time reference CV import](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/6) | #4, #5 |
| T06 | [#7 — Exchange profiles with validated JSON replacement](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/7) | #4, #5 |
| T07 | [#8 — Save and reopen job postings](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/8) | #2 |
| T08 | [#9 — Configure Gemini credentials securely](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/9) | #2 |
| T09 | [#10 — Inspect and authorize a frozen outgoing bundle](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/10) | #4, #5, #8, #9 |
| T10 | [#11 — Run quota-bounded posting analysis](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/11) | #10 |
| T11 | [#12 — Generate and inspect a source-linked draft](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/12) | #11 |
| T12 | [#13 — Catch and repair unsupported draft facts](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/13) | #12 |
| T13 | [#14 — Explain honest qualification gaps](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/14) | #13 |
| T14 | [#15 — Add optional semantic faithfulness review](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/15) | #13 |
| T15 | [#16 — Preview the real ATS document and resolve page fit](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/16) | #12 |
| T16 | [#17 — Edit, revalidate and approve the exact document](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/17) | #13, #16 |
| T17 | [#18 — Export approved selectable-text PDF](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/18) | #17 |
| T18 | [#19 — Export matching editable DOCX](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/19) | #17 |
| T19 | [#20 — Regenerate through safe replacement proposals](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/20) | #17 |
| T20 | [#21 — Recover interrupted generation explicitly](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/21) | #17 |
| T21 | [#22 — Back up and safely restore the workspace](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/22) | #7, #21 |
| T22 | [#23 — Verify the installed workflow and two-job pilot](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/23) | #6, #14, #15, #18, #19, #20, #22 |

## Publication checks

- All 86 parent user stories mapped to the approved slices.
- Acyclic graph, no redundant direct dependencies, and final verification transitively gates every slice.
- Read-back verified all 22 issue bodies, titles, open states, `ready-for-agent` labels, parent relationships and exact native blocking edges.
- Each issue contains the requested Parent / What to build / Acceptance criteria structure. The unblocked root explicitly says it can start immediately; other blockers live in native relationships rather than duplicate body lists.
- Existing prototype approval, screenshots and inspection notes remain design evidence—not completed production behavior or a substitute for the acceptance criteria.
