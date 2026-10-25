# Session outcome replay after a receipt-write gap (LAM-13)

A successful session create/resume is retained in `messages` before its inbox receipt is inserted.
If execution stops between those two writes, the durable operation result exists but the inbox entry
does not. A later exact retry goes through the operation-result branch. That branch previously returned
the original transport envelope, even after its thirty-second deadline expired, so the caller could
not decode an otherwise valid retained session result. PR #51 covered the inbox path only.

Both replay paths now use the same scoped response handling. The original request still passes its
normal protocol/deadline/authenticated-peer and exact fingerprint checks first. A cached envelope is
validated without treating its old transport deadline as a new request deadline. It must belong to the
local node and requesting peer, correlate to the original message, and match its task identity. For
session results, type, owning node and the requested create agent/workspace or resume session ID must
also match. Invalid records are refused, never used as a reason to invoke an Adapter again.

A transport envelope that is still valid is returned unchanged. If only the cached envelope has expired,
the receiver issues a new message ID and transport deadline around the same recorded outcome and original
correlation. It does not create/resume another session, refresh the provider, rewrite the operation record,
reconstruct the missing inbox row or expand retention. Missing outcomes remain uncertain/refused. Changed
requests conflict; an expired original request is still rejected before either replay path.

The two positive regressions retain the SQLite operation prefix, omit the final inbox row, close/reopen
the database, advance the observation clock past the reply deadline, and retry without registering any
Adapter in the reopened receiver. They check decodable fresh transport, unchanged native/session identity,
one original native operation, unchanged ledgers and no extra session. They failed against the previous
runtime. This simulates a durable write boundary; it is not a hardware crash experiment.

Four scope-negative cases cover create/resume via both operation and inbox caches, including malformed
headers, foreign owner/peer/correlation/task, invalid deadlines/types/session identity, changed requests,
unknown operation outcomes and expired original requests. They assert no fallback native call/probe.
Existing inbox/aged-ACK and UNKNOWN tests retain their prior coverage.

This software-only candidate does not run a real Harness or physical window, merge a PR, close #13, or
replace Windows #18's reviewed `60e6e88` execution source. #15 remains deferred.
