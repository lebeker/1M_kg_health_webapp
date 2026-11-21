# E01 smoke — the viewer draws a graph a fresh agent built from one sentence

INFRASTRUCTURE SMOKE TEST, NOT PRODUCT ACCEPTANCE. The document this run produces is
synthetic — an invented example record, titled as such — and it proves only that the harness
runs end to end: clean room, one prompt, branch build, screenshot, DOM, replay. It proves no
product card and opens no product gate.

## Acceptance
A page that shows the agent's own document: its title, the node and edge counts the document
actually contains, and no crash.

## e2e
prompt: Map my health record so I can look at it — an invented patient, one visit, two lab results, labelled synthetic.
expect: synthetic
