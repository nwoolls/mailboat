# Gmail API fixtures

JSON shaped like real Gmail REST API responses (v1), following Google's
reference docs. They are hand-built because no account was connected when
they were written. Replace them with scrubbed real recordings once OAuth works;
keep the IDs (`t1`, `m1`, ...) so the tests still line up.

Scenario: inbox has t1 (2 messages, one unread, user label "Work") and t2
(starred, with a PDF attachment). `history.json` then adds t3, archives t1 and
deletes t2's only message.
