---
name: markers-to-pdf
description: Use when a health map's numbers must leave the app as a readable card — carries every marker with its value, reference, flag, date and source into one paginated PDF, and writes nothing back to kg.json.
---

# Markers → PDF

The main view draws a panel: a marker, the range it was read against, the flag the lab printed,
the day it was drawn and the document behind it. Someone then asks for it on paper — to take to
an appointment, to put in a folder, to hand to a doctor who does not want a web page. This skill
is that exit. It is **not** a UI and never will be: the app has no write path by design, and an
export is the place where that stops mattering.

Read the `kg` skill first. This skill decides **what leaves and how it is printed**; reading and
validating the document is `kg`, and `docs/MAIN-VIEW.md` (in the health app's repo) is the
definition of what a marker is.

## The one rule that outranks the rest

**Read-only.** The graph is the source. The export opens it, prints it and stops. No `add-node`,
no `set-node`, no edited copy of `kg.json`, no note added because the export had an opinion. A
PDF that changes the record it describes is a second record, and two records of one person is
the thing this app exists to avoid.

The script enforces it in the small way a script can: it refuses an `--out` that resolves to the
graph, and no code path opens the input for writing.

## What a marker is

`body/lib/main-view.js` holds the rules; this skill's script is a port of them, field for field,
and the app's own test suite (`scripts/skills.test.ts`) runs both on the demo and compares them.
So the definition here is the app's, not a second opinion:

| field | where it comes from | when it is missing |
|---|---|---|
| name | `values[].name` (or `label`, or the code) inside a panel; `label` of a single test | never — a marker without a name is not a row |
| value | `values[].value`; a bare `value` on the record | no number, no row: a record with no number is counted and named in the report, not printed as a blank |
| unit | `values[].unit` | printed empty; the value keeps its number |
| reference | `values[].ref` (or `{low, high}`, or `ref_low`/`ref_high`) | `—`, and the row is in the report as having no range |
| flag | `values[].flag`, **as the lab printed it** (`low`/`normal`/`high`/`critical`) | `above range` / `below range`, said to be the export's own reading |
| date | the record's `when`, or the demo-era `date` | the date cell prints `—`; the export never invents one |
| source | the `document` node named by the record's `source`, with its `lab`, `address` and `link` | `source: no document behind it`, plus a `missing:` line naming what else is absent |
| meaning | `meaning`, `summary` or `desc` | the "what it means" line is omitted, not filled with boilerplate |

A panel is one card: a lipid panel is four rows under one date and one document, a single test is
one row. Cards run in date order and never interleave; a card that crosses a page break repeats
its heading and the table header, marked `(continued)`.

## The procedure

1. **Find the graph.** `kg.json` (or a graph the `kg` skill already has open). If `kg check`
   reports the document is not health-shaped, say so and stop: this export reads analysis and
   observation records, and printing the wrong kind of document is worse than printing nothing.
2. **Write the script out.** The code below is the whole tool. Copy it verbatim to
   `markers_to_pdf.py` beside the graph (it is also kept at `skills/markers-to-pdf/scripts/` in
   the health app repo). It needs python3 and nothing else — no reportlab, no pandoc, no
   browser, no network.
3. **Run it.**

   ```
   python3 markers_to_pdf.py --graph kg.json --out markers.pdf --json
   ```

   `--json` prints the report the step below reads: every card, every row, the page count, and
   what was missing.
4. **Check it before handing it over.** Page count ≥ 1; marker count equal to the number of rows
   in the document's analysis records; every row in the JSON has a date, a source (or the explicit
   "no document behind it") and a flag cell. If a page is blank the layout is broken — say so
   instead of sending it.
5. **Report the shape, not the effort.** "13 markers from 6 panels, 2 pages, written to
   `markers.pdf`. Five panels have no document, so their source line says so; two flags are my
   reading of the value against the range, not the lab's." Never "the lab flagged LDL as high"
   when the word came from this export.

## What the PDF says about itself

Every page carries `page N of M · markers-to-pdf · read-only, kg.json unchanged`, so a page that
gets separated from the rest still says what produced it. The first page states the read-only
rule and the flag provenance in one line. A card says `not confirmed` beside a document nobody
has checked, because the app says it there too and a print that drops it looks more certain than
the screen it came from.

No rounding, no re-formatting of a number: `6.1` is printed `6.1`, `71` is printed `71`. A value
the document states comes out as itself.

## Limits, stated rather than hidden

- **A PDF is not machine-readable, and this one does not pretend to be.** Nothing here is
  PDF/A: the base-14 fonts are not embedded. For a file that another system can read, use
  `markers-to-fhir`.
- **Only markers.** Conditions, medications, decisions and summaries are not in this export.
  They have their own views, and a card that mixed them would be a different document with a
  different promise.
- **No interpretation.** The export does not say what a number means beyond *above range* /
  *below range*; the plain-language meaning it prints is the one already in the record.
- **Numbers are copied, not recalculated.** No unit conversion, no range arithmetic, no rounding.

## The script

The block below is a verbatim copy of `skills/markers-to-pdf/scripts/markers_to_pdf.py` from the
health app repo. The app hands this skill to `kg` through `app.json`'s `requires.skills` and
`skills_url` (`<repo>/main/skills`), and `kg check --install` fetches **only this file** — which
is why the code lives in it. Edit the `.py` and re-copy it; `scripts/skills.test.ts` fails when
the two drift, and that failure is the reminder.

<!-- script: scripts/markers_to_pdf.py — copied from the .py of the same name by `bun scripts/skills.ts --embed`; edit the .py, not this block -->
```python
#!/usr/bin/env python3
"""Markers -> one paginated card/story, as a PDF. Read-only in both directions.

Every marker the main view draws (a row of `MainView.markers`) leaves the app as a PDF: the
value, the reference range it was read against, the flag the lab printed (or the export's own
reading, said out loud), the date of the record and the document behind it.

The rules this file keeps, in the order the card states them:

  1. **Nothing is written back.** The graph is opened read-only. There is no path in this script
     that opens the input for writing, and no `kg.py` call: `kg.json` is the source, not a
     target. A generated note about the numbers is not a fact somebody recorded.
  2. **The marker is the main view's marker.** `markers()`, `source_of()`, `meaning()`, `date_of()`
     are the same rules as `body/lib/main-view.js`, field for field — the export is a print of
     the panel, not a second opinion about it. `scripts/skills.test.ts` runs both on the demo and
     compares them.
  3. **A missing field is printed, never filled.** No lab named, no address, no scan, no flag,
     no reference range: each is said in words. A blank cell would be a lie about a gap.
  4. **A flag the lab did not print is not the lab's.** When the report printed no flag, the
     export says `above range` / `below range` and a footnote states that this is the export's
     reading of the value against the range.
  5. **The PDF is the only dependency.** No reportlab, no pandoc, no browser, no network. It is
     a PDF 1.4 file written by hand with the base-14 fonts, so it runs on any machine with
     python3 and nothing else. Content streams are uncompressed and the output is deterministic:
     the same graph produces the same bytes, which a test can hold.

Usage:

    python3 markers_to_pdf.py --graph kg.json --out markers.pdf
    python3 markers_to_pdf.py --graph kg.json --out markers.pdf --json

`--json` prints the same report the test reads: every card, every marker row, the page count and
what was missing. It is the export's own account of what it did, not a log.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

FLAGS = ("low", "normal", "high", "critical")

# ---------------------------------------------------------------------------------------------
# The main view's rules, restated in Python. `body/lib/main-view.js` is the source of truth; this
# is a port, and the parity test is what keeps it one.
# ---------------------------------------------------------------------------------------------


def text(value):
    """`text()` in main-view.js: null/undefined is "", everything else is its string, stripped."""
    return "" if value is None else str(value).strip()


def num(value):
    """`num()` in main-view.js: a finite number, or a numeric string; anything else is None."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if value == value and abs(value) != float("inf") else None
    if isinstance(value, str) and value.strip() != "":
        try:
            parsed = float(value.strip())
        except ValueError:
            return None
        return parsed if parsed == parsed and abs(parsed) != float("inf") else None
    return None


def js_number(value):
    """How JavaScript prints a number: `4` not `4.0`, `4.94` as it is."""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return repr(value) if isinstance(value, float) else str(value)


def truthy(value):
    """JavaScript truthiness, which the `||` chains in main-view.js rely on."""
    if value is None or value is False:
        return False
    if isinstance(value, (int, float)) and not isinstance(value, bool) and value == 0:
        return False
    if isinstance(value, str) and value == "":
        return False
    if isinstance(value, (list, dict)) and len(value) == 0:
        return False
    return True


def first_truthy(*values):
    for value in values:
        if truthy(value):
            return value
    return None


def day(value):
    if isinstance(value, dict):
        value = value.get("from")
    match = re.match(r"^(\d{4})-(\d{2})-(\d{2})", "" if value is None else str(value))
    return f"{match.group(1)}-{match.group(2)}-{match.group(3)}" if match else ""


def date_of(node):
    node = node or {}
    return day(node.get("when")) or day(node.get("date"))


def label_of(node):
    return text(first_truthy((node or {}).get("label"), (node or {}).get("id")))


def id_of(node):
    return text((node or {}).get("id"))


def reference_text(low, high):
    if low is None and high is None:
        return ""
    if low is None:
        return "up to " + js_number(high)
    if high is None:
        return "from " + js_number(low)
    return js_number(low) + " – " + js_number(high)


def marker(name, value, unit, ref, flag, code):
    low = high = None
    if isinstance(ref, list):
        low = num(ref[0]) if len(ref) > 0 else None
        high = num(ref[1]) if len(ref) > 1 else None
    elif isinstance(ref, dict):
        low, high = num(ref.get("low")), num(ref.get("high"))
    out = (low is not None and value < low) or (high is not None and value > high)
    printed = flag if flag in FLAGS else ""
    return {
        "name": text(name),
        "value": value,
        "unit": text(unit),
        "ref": None if low is None and high is None else [low, high],
        "reference": reference_text(low, high),
        "flag": printed,
        "from": "lab" if printed else ("range" if out else ""),
        "out": (printed != "normal") if printed else out,
        "code": text(code),
    }


def markers(node):
    """The whole panel, not one number: `values` is a panel, a bare `value` is a single test."""
    out = []
    node = node or {}
    if isinstance(node.get("values"), list):
        for row in node["values"]:
            row = row if isinstance(row, dict) else {}
            value = num(row.get("value"))
            if value is None:
                continue  # no number, no row: nothing to put in a table
            out.append(marker(first_truthy(row.get("name"), row.get("label"), row.get("code")),
                              value, row.get("unit"), row.get("ref"), row.get("flag"),
                              row.get("code")))
        return out
    single = num(node.get("value"))
    if single is not None:
        has_ref = node.get("ref_low") is not None or node.get("ref_high") is not None
        ref = [node.get("ref_low"), node.get("ref_high")] if has_ref else None
        out.append(marker(first_truthy(node.get("label"), node.get("id")), single, node.get("unit"),
                          ref, node.get("flag"), node.get("code")))
    return out


def source_of(node, by_id):
    node = node or {}
    source_id = node.get("source")
    doc = by_id.get(source_id) if isinstance(source_id, str) else None
    lab = text(node.get("lab")) or text((doc or {}).get("lab")) or text((doc or {}).get("publisher"))
    address = text(node.get("address")) or text((doc or {}).get("address"))
    link = text(node.get("scan")) or text(node.get("link")) or text((doc or {}).get("link"))
    gaps = []
    if not doc:
        gaps.append("no document behind it")
    if not lab:
        gaps.append("no lab named")
    if not address:
        gaps.append("no address")
    if not link:
        gaps.append("no scan to open")
    return {
        "lab": lab,
        "address": address,
        "link": link,
        "document": None if not doc else {
            "id": id_of(doc),
            "label": label_of(doc),
            "link": text(doc.get("link")),
            "confirmed": doc.get("confirmed") is True,
        },
        "gaps": gaps,
    }


def meaning(node):
    node = node or {}
    return text(node.get("meaning")) or text(node.get("summary")) or text(node.get("desc"))


# ---------------------------------------------------------------------------------------------
# Reading the document
# ---------------------------------------------------------------------------------------------

ANALYSIS_KINDS = ("analysis", "observation")  # the kinds the main view opens as a panel


def cards_of(graph):
    nodes = [n for n in (graph.get("nodes") or []) if isinstance(n, dict)]
    by_id = {id_of(n): n for n in nodes if id_of(n)}
    cards, empty = [], []
    for node in nodes:
        if text(node.get("kind")) not in ANALYSIS_KINDS:
            continue
        rows = markers(node)
        if not rows:
            empty.append({"node": id_of(node), "label": label_of(node), "date": date_of(node)})
            continue
        source = source_of(node, by_id)
        cards.append({
            "node": id_of(node),
            "label": label_of(node),
            "date": date_of(node),
            "panel": text(node.get("panel")),
            "organ": text(node.get("organ")),
            "confirmed": node.get("confirmed") is True,
            "source": None if not source["document"] else source["document"]["id"],
            "source_label": None if not source["document"] else source["document"]["label"],
            "source_confirmed": None if not source["document"]
            else source["document"]["confirmed"],
            "lab": source["lab"],
            "address": source["address"],
            "link": source["link"],
            "gaps": source["gaps"],
            "meaning": meaning(node),
            "markers": rows,
        })
    cards.sort(key=lambda card: (card["date"], card["node"]))
    return cards, empty


# ---------------------------------------------------------------------------------------------
# Helvetica metrics — Adobe's published widths, in 1/1000 em. Wrapping and truncation are only as
# good as these; without them a table cell overflows the page and the export silently lies.
# ---------------------------------------------------------------------------------------------

WIDTHS_REGULAR = {
    " ": 278, "!": 278, '"': 355, "#": 556, "$": 556, "%": 889, "&": 667, "'": 191, "(": 333,
    ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278, ":": 278, ";": 278,
    "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015, "A": 667, "B": 667, "C": 722, "D": 722,
    "E": 667, "F": 611, "G": 778, "H": 722, "I": 278, "J": 500, "K": 667, "L": 556, "M": 833,
    "N": 722, "O": 778, "P": 667, "Q": 778, "R": 722, "S": 667, "T": 611, "U": 722, "V": 667,
    "W": 944, "X": 667, "Y": 667, "Z": 611, "[": 278, "\\": 278, "]": 278, "^": 469, "_": 556,
    "`": 333, "a": 556, "b": 556, "c": 500, "d": 556, "e": 556, "f": 278, "g": 556, "h": 556,
    "i": 222, "j": 222, "k": 500, "l": 222, "m": 833, "n": 556, "o": 556, "p": 556, "q": 556,
    "r": 333, "s": 500, "t": 278, "u": 556, "v": 500, "w": 722, "x": 500, "y": 500, "z": 500,
    "{": 334, "|": 260, "}": 334, "~": 584,
}
WIDTHS_BOLD = {
    " ": 278, "!": 333, '"': 474, "#": 556, "$": 556, "%": 889, "&": 722, "'": 238, "(": 333,
    ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278, ":": 333, ";": 333,
    "<": 584, "=": 584, ">": 584, "?": 611, "@": 975, "A": 722, "B": 722, "C": 722, "D": 722,
    "E": 667, "F": 611, "G": 778, "H": 722, "I": 278, "J": 556, "K": 722, "L": 611, "M": 833,
    "N": 722, "O": 778, "P": 667, "Q": 778, "R": 722, "S": 667, "T": 611, "U": 722, "V": 667,
    "W": 944, "X": 667, "Y": 667, "Z": 611, "[": 333, "\\": 278, "]": 333, "^": 584, "_": 556,
    "`": 333, "a": 556, "b": 611, "c": 556, "d": 611, "e": 556, "f": 333, "g": 611, "h": 611,
    "i": 278, "j": 278, "k": 556, "l": 278, "m": 889, "n": 611, "o": 611, "p": 611, "q": 611,
    "r": 389, "s": 556, "t": 333, "u": 611, "v": 556, "w": 778, "x": 556, "y": 556, "z": 500,
    "{": 389, "|": 280, "}": 389, "~": 584,
}
for _digit in "0123456789":
    WIDTHS_REGULAR[_digit] = 556
    WIDTHS_BOLD[_digit] = 556

# Characters WinAnsi cannot carry, replaced before the byte conversion: a marker whose unit is
# `µmol/l` must not print as `?mol/l` without saying so.
SUBSTITUTIONS = {"→": "->", "←": "<-", "≈": "~", "≤": "<=", "≥": ">=", "×": "x",
                 "−": "-", "\u2009": " ", "\u202f": " ", "\u00a0": " "}


def winansi(string):
    """The text as WinAnsi bytes, carried in a latin-1 str so the assembled stream stays exact.

    Called once per string, at the point it becomes a number on the page or bytes in the file.
    Applying it twice would turn `–` (0x96) into `?`, because 0x96 is a control character in
    Unicode — which is exactly the bug this comment exists to stop coming back.
    """
    for bad, good in SUBSTITUTIONS.items():
        string = string.replace(bad, good)
    return string.encode("cp1252", "replace").decode("latin-1")


def width(string, size, bold=False):
    table = WIDTHS_BOLD if bold else WIDTHS_REGULAR
    return sum(table.get(ch, 556) for ch in winansi(string)) / 1000.0 * size


def fit(string, max_width, size, bold=False):
    """The longest prefix that fits, with an ellipsis when something had to be cut."""
    if width(string, size, bold) <= max_width:
        return string
    cut = len(string)
    while cut > 0 and width(string[:cut] + "\u2026", size, bold) > max_width:
        cut -= 1
    return string[:cut].rstrip() + "\u2026"


def wrap(string, max_width, size, bold=False):
    lines, current = [], ""
    for word in string.split():
        candidate = word if current == "" else current + " " + word
        if width(candidate, size, bold) <= max_width:
            current = candidate
            continue
        if current:
            lines.append(current)
        while width(word, size, bold) > max_width:  # a word longer than the column
            cut = len(word)
            while cut > 1 and width(word[:cut], size, bold) > max_width:
                cut -= 1
            lines.append(word[:cut])
            word = word[cut:]
        current = word
    if current:
        lines.append(current)
    return lines or [""]


# ---------------------------------------------------------------------------------------------
# A very small PDF writer: pages of positioned text, two base-14 fonts, uncompressed streams.
# ---------------------------------------------------------------------------------------------


def to_unicode_cmap():
    """WinAnsi code -> Unicode, for every byte a WinAnsi font can print.

    Without this a PDF still draws correctly in most viewers but copies as mojibake, and text
    extraction returns `?` for every dash and micro sign. A laboratory value that cannot be
    copied out is not exported.
    """
    entries = []
    for code in list(range(0x20, 0x7F)) + list(range(0x80, 0x100)):
        try:
            char = bytes([code]).decode("cp1252")
        except UnicodeDecodeError:
            continue
        entries.append(f"<{code:02X}> <{ord(char):04X}>")
    lines = ["/CIDInit /ProcSet findresource begin", "12 dict begin", "begincmap",
             "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
             "/CMapName /Adobe-Identity-UCS def", "/CMapType 2 def",
             "1 begincodespacerange", "<00> <FF>", "endcodespacerange"]
    for start in range(0, len(entries), 100):
        chunk = entries[start:start + 100]
        lines.append(f"{len(chunk)} beginbfchar")
        lines.extend(chunk)
        lines.append("endbfchar")
    lines += ["endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end"]
    return "\n".join(lines)


class Page:
    def __init__(self):
        self.ops = []

    def text(self, x, baseline, string, size=9.0, bold=False, grey=0.0):
        if not string:
            return
        body = escape(string)
        self.ops.append(f"{grey:.2f} {grey:.2f} {grey:.2f} rg BT /{'F2' if bold else 'F1'} "
                        f"{size:.2f} Tf 1 0 0 1 {x:.2f} {baseline:.2f} Tm ({body}) Tj ET\n")

    def rule(self, x, baseline, length, weight=0.5, grey=0.6):
        self.ops.append(f"{grey:.2f} {grey:.2f} {grey:.2f} rg {x:.2f} {baseline:.2f} "
                        f"{length:.2f} {weight:.2f} re f\n")


def escape(string):
    safe = winansi(string)
    return safe.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


A4 = (595.276, 841.890)
MARGIN_X, MARGIN_TOP, MARGIN_BOTTOM = 48.0, 56.0, 52.0
CONTENT = A4[0] - 2 * MARGIN_X

# Table geometry. The five fields the card names are all visible per row: value, reference, flag,
# date, source. The LOINC code rides under the marker's name, as it does in the app.
COLUMNS = [
    ("MARKER", 48.0, 130.0, "left"),
    ("VALUE", 180.0, 48.0, "right"),
    ("UNIT", 228.0, 44.0, "left"),
    ("REFERENCE", 272.0, 80.0, "left"),
    ("FLAG", 352.0, 52.0, "left"),
    ("DATE", 404.0, 58.0, "left"),
    ("SOURCE", 462.0, 85.0, "left"),
]
HEADER_SIZE, ROW_SIZE, CODE_SIZE = 6.8, 8.0, 6.4


def flag_word(row):
    if row["from"] == "lab":
        return row["flag"]
    if row["from"] == "range":
        high = row["ref"][1] if row["ref"] else None
        return "above range" if high is not None and row["value"] > high else "below range"
    return "—"


class Report:
    """The PDF, and the account of what went into it."""

    def __init__(self):
        self.pages = [Page()]
        self.top = A4[1] - MARGIN_TOP
        self.bottom = MARGIN_BOTTOM
        self.y = self.top

    # -- page mechanics ------------------------------------------------------------------
    def new_page(self):
        self.pages.append(Page())
        self.y = self.top

    def ensure(self, height):
        if self.y - height < self.bottom:
            self.new_page()

    def put(self, string, x, size, bold=False, grey=0.0, line=None):
        """One line, top-anchored: `self.y` is where the next line starts."""
        self.y -= line if line is not None else size + 3.0
        self.pages[-1].text(x, self.y, string, size=size, bold=bold, grey=grey)

    # -- content -------------------------------------------------------------------------
    def title(self, graph, cards, empty):
        meta = graph.get("meta") or {}
        title = text(meta.get("title")) or "Markers"
        self.put(fit(title, CONTENT, 16, bold=True), MARGIN_X, 16, bold=True, line=20)
        subtitle = f"{sum(len(card['markers']) for card in cards)} markers · {len(cards)} " \
                   f"{'panel' if len(cards) == 1 else 'panels'}"
        if empty:
            subtitle += f" · {len(empty)} analysis record(s) with no number, not in the table"
        if meta.get("demo") is True:
            subtitle += " · demo data — invented records, not a person's"
        self.put(subtitle, MARGIN_X, 9, grey=0.3, line=14)
        rule = ("Read-only export: this PDF is written beside the document and kg.json is not "
                "touched. A flag with `lab` beside it was printed by the laboratory; "
                "`above range` / `below range` is this export's own reading, and says so.")
        for line_text in wrap(rule, CONTENT, 7.5):
            self.put(line_text, MARGIN_X, 7.5, grey=0.45, line=10)
        self.y -= 6
        self.pages[-1].rule(MARGIN_X, self.y, CONTENT, weight=0.8, grey=0.75)
        self.y -= 14

    def table_header(self):
        page = self.pages[-1]
        for name, x, w, align in COLUMNS:
            x_text = x + w - 4 - width(name, HEADER_SIZE, True) if align == "right" else x
            page.text(x_text, self.y - HEADER_SIZE, name, size=HEADER_SIZE, bold=True, grey=0.35)
        self.y -= HEADER_SIZE + 4
        page.rule(MARGIN_X, self.y, CONTENT, weight=0.4, grey=0.8)
        self.y -= 8

    def card(self, card):
        self.ensure(110)
        heading = card["label"] + ("  ·  " + card["date"] if card["date"] else "")
        self.put(fit(heading, CONTENT, 11.5, bold=True), MARGIN_X, 11.5, bold=True, line=15)
        # A heading's descenders sit 11.5 pt below its baseline; the table header needs its own air.
        self.y -= 4
        subline = " · ".join(part for part in (
            (card["panel"] + " panel") if card["panel"] else card["organ"],
            card["lab"],
            card["address"],
        ) if part)
        if subline:
            self.put(fit(subline, CONTENT, 7.8), MARGIN_X, 7.8, grey=0.25, line=11)
        source_line = "source: " + (card["source"] or "no document behind it")
        if card["source_label"]:
            source_line += " — " + card["source_label"]
        if card["source_confirmed"] is False:
            source_line += " · not confirmed"
        if card["link"]:
            source_line += " · " + card["link"]
        self.put(fit(source_line, CONTENT, 7.8), MARGIN_X, 7.8, grey=0.25, line=11)
        if card["gaps"]:
            self.put(fit("missing: " + " · ".join(card["gaps"]), CONTENT, 7.8),
                     MARGIN_X, 7.8, grey=0.45, line=11)
        self.y -= 3
        self.table_header()
        derived = []
        for row in card["markers"]:
            height = 21.0 if row["code"] else 14.0
            if self.y - height < self.bottom:
                self.new_page()
                self.put(fit(heading + " (continued)", CONTENT, 11.5, bold=True), MARGIN_X, 11.5,
                         bold=True, line=15)
                self.y -= 4
                self.table_header()
            cells = [
                row["name"],
                js_number(row["value"]),  # the number as recorded, not a reformatting of it
                row["unit"],
                row["reference"] or "—",
                flag_word(row),
                card["date"] or "—",
                card["source"] or "—",
            ]
            for (_, x, w, align), value in zip(COLUMNS, cells):
                cell = fit(value, w - 4, ROW_SIZE)
                text_x = x + w - 4 - width(cell, ROW_SIZE) if align == "right" else x
                self.pages[-1].text(text_x, self.y - ROW_SIZE, cell, size=ROW_SIZE)
            self.y -= ROW_SIZE + 4
            if row["code"]:
                self.pages[-1].text(COLUMNS[0][1], self.y - CODE_SIZE, "(" + row["code"] + ")",
                                    size=CODE_SIZE, grey=0.45)
                self.y -= 6
            if row["from"] == "range":
                derived.append(row)
            self.y -= 1
        self.y -= 2
        if derived:
            names = ", ".join(row["name"] for row in derived)
            for line_text in wrap(f"flag reading: the report printed no flag for {names}; the word "
                                  "in that row is this export comparing the value with the "
                                  "reference, not the lab's.", CONTENT, 7.5):
                self.put(line_text, MARGIN_X, 7.5, grey=0.45, line=10)
        if card["meaning"]:
            self.put("what it means", MARGIN_X, 7.2, bold=True, grey=0.35, line=10)
            for line_text in wrap(card["meaning"], CONTENT, 8.5):
                self.put(line_text, MARGIN_X, 8.5, line=11.5)
        self.y -= 10
        self.pages[-1].rule(MARGIN_X, self.y, CONTENT, weight=0.4, grey=0.78)
        self.y -= 14

    # -- output --------------------------------------------------------------------------
    def save(self, path):
        total = len(self.pages)
        for number, page in enumerate(self.pages, start=1):
            page.text(MARGIN_X, 28,
                      f"page {number} of {total} · markers-to-pdf · read-only, kg.json unchanged",
                      size=7, grey=0.5)

        # Object layout: 1 catalog, 2 pages, 3-4 fonts, 5 ToUnicode, then page/content pairs
        # from 6. The map is what makes the text selectable and copyable: a value a reader has
        # to retype is a value the export half-delivered.
        objects = [
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [" + " ".join(f"{6 + 2 * i} 0 R" for i in range(total)) +
            f"] /Count {total} >>",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding "
            "/ToUnicode 5 0 R >>",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding "
            "/WinAnsiEncoding /ToUnicode 5 0 R >>",
        ]
        cmap = to_unicode_cmap()
        objects.append(f"<< /Length {len(cmap)} >>\nstream\n{cmap}\nendstream")
        for index, page in enumerate(self.pages):
            content = "".join(page.ops).encode("latin-1")
            objects.append(
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {A4[0]:.3f} {A4[1]:.3f}] "
                f"/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> "
                f"/Contents {7 + 2 * index} 0 R >>")
            objects.append(f"<< /Length {len(content)} >>\nstream\n"
                           + content.decode("latin-1") + "\nendstream")

        out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets = []
        for number, body in enumerate(objects, start=1):
            offsets.append(len(out))
            out += f"{number} 0 obj\n{body}\nendobj\n".encode("latin-1")
        xref_at = len(out)
        out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode("latin-1")
        for offset in offsets:
            out += f"{offset:010d} 00000 n \n".encode("latin-1")
        out += (f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n"
                f"{xref_at}\n%%EOF\n").encode("latin-1")
        Path(path).write_bytes(bytes(out))
        return len(out)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Every marker of the main view, as one paginated PDF.")
    parser.add_argument("--graph", required=True, help="the kg/1 document (read-only)")
    parser.add_argument("--out", required=True, help="the PDF to write")
    parser.add_argument("--json", action="store_true", help="print the report as JSON")
    args = parser.parse_args(argv)

    graph_path, out_path = Path(args.graph), Path(args.out)
    if graph_path.resolve() == out_path.resolve():
        print("refusing: --out is the graph; the export never writes kg.json", file=sys.stderr)
        return 2
    try:
        graph = json.loads(graph_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"cannot read {graph_path}: {error}", file=sys.stderr)
        return 2

    cards, empty = cards_of(graph)
    report = Report()
    report.title(graph, cards, empty)
    for card in cards:
        report.card(card)
    if not cards:
        report.put("no markers: no analysis or observation record here carries a number",
                   MARGIN_X, 9, grey=0.35, line=12)
    size = report.save(out_path)

    summary = {
        "graph": str(graph_path),
        "pdf": str(out_path),
        "bytes": size,
        "pages": len(report.pages),
        "cards": cards,
        "markers": sum(len(card["markers"]) for card in cards),
        "flags_derived": sum(1 for card in cards for row in card["markers"]
                             if row["from"] == "range"),
        "skipped": empty,
    }
    if args.json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        print(f"{summary['markers']} markers from {len(cards)} panels -> {out_path} "
              f"({summary['pages']} pages, {size} bytes)")
        print(f"kg.json not touched: {graph_path}")
        if empty:
            print("not in the table (no number on the record): "
                  + ", ".join(entry["node"] for entry in empty))
        gaps = {gap for card in cards for gap in card["gaps"]}
        if gaps:
            print("missing fields, printed in the PDF: " + "; ".join(sorted(gaps)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```
<!-- /script -->
