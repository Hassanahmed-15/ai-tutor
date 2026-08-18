# /adhd-lab

A deterministic harness for ADHD features — the same idea as `/board-lab` and `/structure-lab`.

ADHD features are stateful and time-dependent: drift, recovery, capture, card review at day 1/3/7.
Reaching those states through a real lecture means waiting for a real drift, which is slow and not
reproducible. Drive the state directly from query params instead, so a Playwright run can assert on
a specific moment.

The page itself lands with the first feature that needs it — this file marks the convention so the
route is not invented somewhere else in the meantime.
