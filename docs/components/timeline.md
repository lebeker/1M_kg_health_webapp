# The ruler (timeline)

Fixed by `docs/wireframe-health-v11-analysis.svg`. Full width, above the three columns.

## What it is

The page's one navigator. It draws a life as a line of time — birth on the left, a projection forty
years past today on the right — and everything the document records sits on it as a marker. Picking
anywhere on it moves the whole page to that day, so it is also the only control that decides which
day the centre and the panel are talking about.

## What it must do

1. **Span the page.** Edge to edge above the columns, never pinned between them, never scrolled.
2. **Two scales.** The two years either side of today are drawn month by month; the rest of the life
   is drawn year by year. The window is a band on the ruler, not a second widget.
3. **Label what matters.** Decades carry a label; the birth year carries its own, in its own colour;
   today carries its own, in its own colour. Labels never print on top of each other.
4. **One marker per record.** Every analysis, diagnosis and summary in the document is one marker on
   its own day. Two records in one month are two markers, not one.
5. **The marker opens the record.** Clicking a marker opens *that record* in the centre, highlights
   its row in the records list, and moves the panel to its date. Clicking the bare strip picks the
   day, which is a different thing.
6. **The current record has its own colour.** The marker of the record being shown is drawn larger
   and in the accent colour; with nothing selected, no marker is in it.
7. **The future is not a record.** Ticks to the right of today are painted by the projected risk at
   that age, and carry no markers, because nothing has happened there.
8. **No document, no life.** The template renders an empty strip that says so; it never invents a
   person to draw.

## Scenarios

Run these against the built page with the demo document, then against a document the skill produced
from a one-line story ("at date X I had an analysis Y with results Z").

| # | do | expect |
|---|---|---|
| 1 | open the page at 1280 px | the strip runs from the left edge to the right edge, above all three columns, and does not overlap the header controls |
| 2 | look at the left end | the birth year is labelled in gold and says so; the label is not clipped by the page edge and no other label sits on it |
| 3 | look at today | a blue line with the word "today"; nothing printed over it |
| 4 | look at the two years either side of today | one tick per month, and every January of that window labelled |
| 5 | count markers against the records list | one marker per record, and two records in the same month are two markers |
| 6 | click the marker of the ALT 2026-10-21 analysis | the centre shows that analysis (not the summary), the records list highlights that row, the panel's heading reads 2026-10-21 → 2026-11-23, and the marker turns blue and larger |
| 7 | click the bare strip between two markers | the day changes, the centre shows whatever record stands on that day, and no marker is in the current colour unless one sits there |
| 8 | step with the player's four buttons | each step lands on a record, never on an empty day, and the ruler's readout agrees with the centre |
| 9 | collapse the records list and the panel | the strip stays full width and its markers do not move |
| 10 | load the template with no document | an empty strip that says "no records yet", no invented birth, no markers |

## What is still missing

- The computed "today summary" that the centre shows at launch is a record in the list but has no
  marker of its own, so a page at rest shows no current marker. Either it gets a marker at today, or
  the list's today row stops being selectable.
- The hover card lists the records of a month; it should list one record, now that markers are
  per record.
- The month window is ±2 years by arithmetic, not by the wireframe's own reading of "recent".
