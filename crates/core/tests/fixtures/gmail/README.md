# Gmail API fixtures

JSON shaped like real Gmail REST API responses (v1), following Google's
reference docs. They are hand-built because no account was connected when
they were written. Replace them with scrubbed real recordings once OAuth works;
keep the IDs (`t1`, `m1`, ...) so the tests still line up.

Scenario: inbox has t1 (2 messages, one unread, user label "Work") and t2
(starred, with a PDF attachment). t4 is archived (not in the inbox, label
"Work") and only appears in the All Mail listing. `history.json` then adds t3, archives t1 and
deletes t2's only message.

`message_m2_attachments.json` is t1's second message fetched in full, with
attachments: a PDF named `../../Quarterly report.pdf` (to test unsafe
names), an inline logo the HTML shows as `cid:logo@x` (fetched by
attachment ID), and a tiny inline GIF (`cid:dot@x`) whose data came with
the message. `message_m2_attachments_refetched.json` is the same message
fetched again, where Gmail gave the logo a new attachment ID.
