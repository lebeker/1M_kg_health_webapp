# SCRUM-53 backfill — the product on `main`, from one sentence, with a receipt

BACKFILL, NOT A CARD ACCEPTANCE. Twenty-nine commits merged between E01 and SCRUM-53 with no
clean-room run against them: the harness was fixed and then not used. This fixture asks the product
on `main` the one thing an end-to-end run can ask it — build a record from a sentence and render it
— so those commits are covered by a result rather than by a claim. It opens no product card and does
not stand in for one; a product card's own claim is its own `## e2e` block.

The fixture is the question, not the artifact: it is read from the SCRUM-53 branch while the build
and the commit under test are `main`'s head.

The prompt was rewritten once: the first version asked for "the visit with one blood test" without
giving the values, and the fresh agent correctly refused to invent a lab number — which is the
behaviour the product wants and the wrong fixture for a gate test. A synthetic case has to say it is
synthetic and carry its own facts.

## Acceptance
The agent's document, rendered by the build of `main`: its own title, the node and edge counts the
document actually contains, the profile the agent was asked for read back in the page, and the
synthetic label visible so nobody mistakes it for a person.

## e2e
prompt: Build me a health record I can look at — an invented patient labelled synthetic: born 1961, male, one visit on 2024-03-05 with one blood test that day, total cholesterol 5.4 mmol/L against a reference of 0 to 5.0, flagged high.
expect: synthetic, nodes, edges, age 65
