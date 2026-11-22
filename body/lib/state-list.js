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
 * A row is `{id, kind, date, title, note, stored}`. `stored:false` marks the two rows the page
 * invents (today, and the annual marker for a year the document did not summarise itself), so a
 * reader — or a test — can tell a record from a summary of records.
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
    prediction: "projected"
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
                 note: label(node), stored: true });
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

  /* The today summary closes the list at the top: it is the state as it stands now, so it is
     computed at launch and never written into the document as an event. */
  function todayRow(list, today) {
    var past = list.filter(function (row) { return row.date <= today; });
    var ahead = list.filter(function (row) { return row.date > today; });
    var latest = past.reduce(function (m, row) { return row.date > m ? row.date : m; }, "");
    var note;
    if (!list.length) {
      note = "nothing recorded yet";
    } else {
      note = past.length + (past.length === 1 ? " record" : " records") +
             (latest ? " \u00b7 latest " + latest : "") +
             (ahead.length ? " \u00b7 " + ahead.length + " ahead" : "");
    }
    return { id: "today", kind: "today", date: today, title: "today summary", note: note,
             stored: false };
  }

  /* The list the panel draws: today first, then every record and annual marker, newest on top.
     Nothing else carries an order — a caption section would be a second list. */
  function rows(nodes, today) {
    var list = events(nodes);
    var rest = list.concat(annual(list, today));
    rest.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    return [todayRow(list, today)].concat(rest);
  }

  root.StateList = Object.freeze({ rows: rows, events: events, annual: annual,
                                   todayRow: todayRow, day: day, ROW_KIND: ROW_KIND });
})(typeof globalThis !== "undefined" ? globalThis : this);
