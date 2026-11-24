/* The left panel's list — what was known then, one row per record.
 *
 * Pure on purpose: no DOM and no clock, so `scripts/state-list.test.ts` can state the ordering
 * rules as dates and the page can stay in charge of what a row looks like. The card asked for:
 *
 *   - one list, newest on top: future above, past below — no FUTURE/PAST captions;
 *   - it mixes analyses, diagnoses, summaries and decisions (a record's kind names its row);
 *   - the annual summary is stamped 01-01 of the year after the one it covers;
 *   - the today summary is the first row, generated at launch, never stored as an event.
 *
 * A row is `{id, kind, date, title, note, stored, future}`. `note` is the row's own one line —
 * the record's fact for a stored record (v11 draws "LDL 4.7", not the panel's title), and
 * "N moved, M ignored" for the today summary. `stored:false` marks the rows the page invents
 * (today, and the annual marker for a year the document did not summarise itself), so a reader —
 * or a test — can tell a record from a summary of records. `future:true` marks a row that has not
 * happened yet, which is the dashed marker v11 gives the two rows above today.
 */
(function (root) {
  "use strict";

  /* kind in the document -> row on the list. A record's own kind is the row's name, which is why
     a table of them can mix: the list never groups by kind, it sorts by date. */
  var ROW_KIND = {
    analysis: "analysis",
    observation: "analysis",
    condition: "diagnosis",
    diagnosis: "diagnosis",
    summary: "summary",
    decision: "decision",
    encounter: "visit",
    medication: "medication",
    procedure: "procedure",
    prediction: "projected",
    immunization: "immunization",
    device: "device",
    allergy: "allergy"
  };

  /* a calendar day, not an instant: "2019-04-12" is that day in the reader's calendar whatever
     the timezone. An interval (`when:{from,to}`) starts on its `from` day. */
  function day(value) {
    if (value && typeof value === "object") value = value.from;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value == null ? "" : String(value));
    return m ? m[1] + "-" + m[2] + "-" + m[3] : "";
  }
  function dateOf(node) {
    return day(node && node.when) || day(node && node.date);
  }
  function label(node) {
    return String((node && (node.label || node.id)) || "");
  }
  /* A field as text: the document's own string, or "" — never the word "undefined" on a row. */
  function text(value) {
    return String(value == null ? "" : value).trim();
  }
  /* A clinic and a doctor are either a string or an object with a `name`. */
  function name(value) {
    if (value && typeof value === "object") return text(value.name);
    return text(value);
  }
  /* The numbers a record carries: a panel's `values`, one marker per line, a value that is present
     and not an empty string. */
  function markers(node) {
    var out = [];
    (node && Array.isArray(node.values) ? node.values : []).forEach(function (m) {
      if (m && text(m.value) !== "") out.push(m);
    });
    return out;
  }
  function markerLine(m) {
    return [text(m.name), text(m.value) + (text(m.unit) ? " " + text(m.unit) : "")].filter(Boolean).join(" ");
  }
  /* The lab's own flag, as opposed to a range the page worked out: anything but "normal". */
  function marked(m) {
    return !!m && !!text(m.flag) && !/^normal$/i.test(text(m.flag));
  }

  /* The record's own one line — what the record says, not what it is called. v11 draws "LDL 4.7"
     for a panel titled "Lipid panel", "Family Practice · Dr Petro Melnyk" for a visit whose title
     only repeats its date, and "hyperlipidaemia" for a diagnosis, where the label *is* the fact.
     So: the numbers a measurement carries (the flagged one first, then how many more), who a visit
     was with, who issued a document, else the label — plus a status that is not plain "active",
     plus `not confirmed` when the document says nobody has verified the record. Nothing here is
     prose the page invented, and no row is ever blank. */
  function summaryOf(node) {
    if (!node) return "";
    var kind = String(node.kind || "");
    var line = "";
    var marks = markers(node);
    if (marks.length) {
      line = markerLine(marks.filter(marked)[0] || marks[0]);
      if (marks.length > 1) line += " \u00b7 +" + (marks.length - 1) + " more";
    } else if (text(node.value) !== "") {
      line = text(node.value) + (text(node.unit) ? " " + text(node.unit) : "");
    }
    if (!line && kind === "encounter") {
      line = [name(node.clinic), name(node.doctor)].filter(Boolean).join(" \u00b7 ");
    }
    if (!line && kind === "document") line = text(node.lab) || text(node.publisher);
    if (!line) line = label(node);
    var status = text(node.status);
    if (status && !/^active$/i.test(status)) line += " \u00b7 " + status;
    if (node.confirmed === false) line += " \u00b7 not confirmed";
    return line;
  }

  /* every record the document dates, newest first. A `source` node is provenance, not a record;
     a node without a date is not an event and cannot stand on a timeline. */
  function events(nodes) {
    var out = [];
    (nodes || []).forEach(function (node) {
      if (!node) return;
      var kind = ROW_KIND[node.kind];
      var date = dateOf(node);
      if (!kind || !date) return;
      out.push({ id: String(node.id), kind: kind, date: date, title: kind,
                 note: summaryOf(node), stored: true });
    });
    return out.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  }

  /* One marker per finished year, stamped 01-01 of the year after it. A year that has not ended
     has nothing to summarise yet; a summary the document stored itself wins over the marker. */
  function annual(list, today) {
    var todayYear = +today.slice(0, 4);
    var stored = {};
    list.forEach(function (row) { if (row.kind === "summary") stored[row.date] = true; });
    var years = {};
    list.forEach(function (row) {
      if (row.kind === "summary") return;
      years[+row.date.slice(0, 4)] = true;
    });
    var out = [];
    Object.keys(years).forEach(function (y) {
      var year = +y;
      if (year >= todayYear) return;                    // the year has not ended
      var stamp = year + 1 + "-01-01";
      if (stored[stamp]) return;
      var n = list.filter(function (row) { return +row.date.slice(0, 4) === year; }).length;
      out.push({ id: "annual:" + year, kind: "summary", date: stamp, title: "annual summary",
                 note: year + ": " + n + (n === 1 ? " record" : " records"), stored: false });
    });
    return out;
  }

  /* ---- "N moved, M ignored": the today row's own line, in v11's shape ---------------------
     Both halves are counted from the document, never estimated.

     - **moved**: a track whose newest reading on or before today differs from the reading before
       it. A track with one reading has not moved — there is nothing to compare it with — and a
       track whose repeat came back the same has not moved either.
     - **ignored**: something the document advised (an `advised` edge out of a dated encounter)
       that no record dated on or before today carries. Advice is not a record of doing it, so a
       target that is missing from the document, or present but undated, is the one honest reading
       of "nobody says it happened". Advice whose own date has not arrived is scheduled, not
       ignored, and is left out. */
  function trackOf(node) { return text(node.track) || String((node && node.id) || ""); }
  function readingOf(node) {
    var marks = markers(node);
    if (marks.length) return markerLine(marks[0]);
    return text(node.value) === "" ? "" : text(node.value) + (text(node.unit) ? " " + text(node.unit) : "");
  }
  function moved(nodes, today) {
    var byTrack = {};
    (nodes || []).forEach(function (node) {
      if (!node || !ROW_KIND[node.kind]) return;
      var at = dateOf(node);
      if (!at || at > today) return;
      var reading = readingOf(node);
      if (!reading) return;
      var track = trackOf(node);
      (byTrack[track] = byTrack[track] || []).push({ at: at, reading: reading });
    });
    var count = 0;
    Object.keys(byTrack).forEach(function (track) {
      var list = byTrack[track].sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
      if (list.length < 2) return;
      if (list[list.length - 1].reading !== list[list.length - 2].reading) count++;
    });
    return count;
  }
  function ignored(nodes, edges, today) {
    var byId = {};
    (nodes || []).forEach(function (node) { if (node) byId[String(node.id)] = node; });
    var seen = {};
    var count = 0;
    (edges || []).forEach(function (edge) {
      if (!edge || String(edge.label || "") !== "advised") return;
      var from = byId[String(edge.from)];
      var on = dateOf(from);
      if (!from || !on || on > today) return;                 // nothing dated advised this yet
      var id = String(edge.to);
      if (seen[id]) return;
      seen[id] = true;
      var target = byId[id];
      if (!target) { count++; return; }                        // advised, never recorded
      var at = dateOf(target);
      if (at) return;                                          // done, or still ahead: not ignored
      count++;                                                 // in the record without a date
    });
    return count;
  }

  /* The today summary closes the list at the top: it is the state as it stands now, so it is
     computed at launch and never written into the document as an event. Its line is what moved and
     what was ignored — v11's "3 moved, 1 ignored" — and with no document at all there is nothing to
     count, which the row says rather than printing two honest zeroes. */
  function todayRow(list, today, counts) {
    var note;
    if (!list.length) {
      note = "nothing recorded yet";
    } else {
      var n = counts || { moved: 0, ignored: 0 };
      note = n.moved + " moved, " + n.ignored + " ignored";
    }
    return { id: "today", kind: "today", date: today, title: "today summary", note: note,
             stored: false, future: false };
  }

  /* The list the panel draws: today first, then every record and annual marker, newest on top.
     Nothing else carries an order — a caption section would be a second list. `future` is the
     dashed marker v11 draws on the rows above today: a record that has not happened yet. */
  function rows(nodes, today, edges) {
    var list = events(nodes);
    var rest = list.concat(annual(list, today));
    rest.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    var day0 = day(today);
    rest.forEach(function (row) { row.future = !!day0 && row.date > day0; });
    var counts = { moved: moved(nodes, day0), ignored: ignored(nodes, edges, day0) };
    return [todayRow(list, day0 || today, counts)].concat(rest);
  }

  root.StateList = Object.freeze({ rows: rows, events: events, annual: annual,
                                   todayRow: todayRow, summaryOf: summaryOf,
                                   moved: moved, ignored: ignored, day: day, ROW_KIND: ROW_KIND });
})(typeof globalThis !== "undefined" ? globalThis : this);
