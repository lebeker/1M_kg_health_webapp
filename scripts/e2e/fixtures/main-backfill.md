# SCRUM-53 backfill — the product on `main`, from one sentence, with a receipt

BACKFILL, NOT A CARD ACCEPTANCE. Twenty-nine commits merged between E01 and SCRUM-53 with no
clean-room run against them: the harness was fixed and then not used. This card asks the product
on `main` the one thing an end-to-end run can ask it — build a record from a sentence and render
it — so that those commits are covered by a result rather than by a claim. It opens no product
card and does not stand in for one; a product card's own claim is its own `## e2e` block.

## Acceptance
The agent's document, rendered by the build of `main`: its own title, the node and edge counts the
document actually contains, no crash, and the profile the agent was asked for read back in the
page.

## e2e
prompt: Take this check-up and put it in a health record I can look at — I was born in 1961, and the visit had one blood test with a date on it.
expect: nodes, edges, born 1961
