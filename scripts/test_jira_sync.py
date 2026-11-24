#!/usr/bin/env python3
"""Unit tests for the Jira sync's decisions and its read-back, with a fake client.

No network: the point is that a mapping change, a dropped comment or a write that Jira silently
ignores fails here, deterministically, before it reaches a real ticket. CI runs this file.

    python3 -m unittest scripts/test_jira_sync.py -v
"""
from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("jira_sync", os.path.join(HERE, "jira-sync.py"))
jira_sync = importlib.util.module_from_spec(spec)
# A hyphenated filename cannot be imported by name, so it is loaded by path — and dataclasses
# looks the module up in sys.modules, so it has to be registered there before the module runs.
assert spec is not None and spec.loader is not None
sys.modules[spec.name] = jira_sync
spec.loader.exec_module(jira_sync)

MEX = "712020:4a5a1d3d-2ab3-42fb-8fed-a98e441e9c18"
LIA = "712020:40bb33bc-7d90-4b80-ab8f-afea6579db65"
RIGHT = "617d6aad3e3753006f48c6d3"
IDENTITIES = {"mex": MEX, "lia": None, "right": None}


def card(state: str, assignee: str = "lia", card_id: str = "t_1") -> dict:
    return {"id": card_id, "status": state, "assignee": assignee}


def detail(state: str = "running", assignee: str = "lia", summary: str = "", body: str = "Task: SCRUM-15",
           run_status: str = "running", block_reason: str = "", comments: list[str] | None = None,
           branch_name: str = "") -> dict:
    return {
        "task": {"id": "t_1", "assignee": assignee, "body": body, "block_reason": block_reason,
                 "branch_name": branch_name},
        "run": {"status": run_status, "outcome": None, "summary": summary},
        "comments": [{"author": "someone", "body": text} for text in (comments or [])],
    }


def jira_state(status=None, assignee_id=None, comments=""):
    return jira_sync.JiraState(status=status, assignee_id=assignee_id, comments=comments)


MERGED_SHA = "05e9f8aac7fa6380086dfe950706a00038422d9a"
ELSEWHERE = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"


def pull_request(number: int, state: str, merge_commit: str = "", branch: str = "",
                 body: str = "Task: t_1", title: str = ""):
    return jira_sync.PullRequest(number=number, state=state, merge_commit=merge_commit,
                                branch=branch, body=body, title=title)


def gate(prs, detail_row=None, on_main=(MERGED_SHA,), branch=None, key: str = ""):
    """`evaluate_merge_gate` with the ancestry check replaced by membership in `on_main`.

    `branch=None` means "use whatever the card itself says it was worked on", the way `MergeResolver`
    does it; pass a string to pin one branch explicitly.
    """
    row = detail_row if detail_row is not None else detail("done")
    return jira_sync.evaluate_merge_gate(
        "t_1", row, prs, lambda sha: sha in on_main,
        branch=jira_sync.branches_of(row) if branch is None else branch, key=key,
    )


def merged():
    """Evidence a test is not about, so the mapping tests below keep testing the mapping."""
    return jira_sync.MergeEvidence(kind="merged-pr", reason="PR #8 is MERGED at 05e9f8aac, reachable from origin/main")


class FakeClient:
    """Stands in for Jira. Optionally ignores a write, which is how a silent no-op is tested."""

    def __init__(self, status="To Do", assignee_id=None, comments="", ignore=()):
        self.status = status
        self.assignee_id = assignee_id
        self.comments = comments
        self.ignore = set(ignore)
        self.calls = []

    def read(self, key):
        return jira_state(self.status, self.assignee_id, self.comments)

    def set_assignee(self, key, account):
        self.calls.append(("assign", account))
        if "assign" not in self.ignore:
            self.assignee_id = account

    def transition(self, key, target):
        self.calls.append(("transition", target))
        if "transition" not in self.ignore:
            self.status = target

    def comment(self, key, body):
        self.calls.append(("comment", body))
        if "comment" not in self.ignore:
            self.comments += body


class TestMapping(unittest.TestCase):
    def test_ready_maps_to_to_do(self):
        plan = jira_sync.build_plan(card("ready", "mex"), detail(), jira_state("To Do", MEX), IDENTITIES, "SCRUM-1")
        self.assertEqual(plan.steps, [])

    def test_done_transitions_and_comments(self):
        plan = jira_sync.build_plan(card("done", "mex"), detail("done", "mex", "merged"), jira_state("In Progress", MEX), IDENTITIES, "SCRUM-1", evidence=merged())
        kinds = [step.kind for step in plan.steps]
        self.assertEqual(kinds, ["transition", "comment"])
        self.assertEqual(plan.steps[0].value, "Done")
        self.assertIn("PR #8", plan.steps[1].value)

    def test_an_unmapped_state_is_left_alone_with_a_warning(self):
        plan = jira_sync.build_plan(card("triage", "mex"), detail(), jira_state("To Do", MEX), IDENTITIES, "SCRUM-1")
        self.assertEqual([step.kind for step in plan.steps], [])
        self.assertTrue(any("no Jira mapping" in warning for warning in plan.warnings))

    def test_blocked_is_held_on_purpose_and_is_not_a_warning(self):
        plan = jira_sync.build_plan(
            card("blocked", "mex"),
            detail("blocked", "mex", block_reason="waiting on admin", run_status="blocked"),
            jira_state("In Progress", MEX),
            IDENTITIES,
            "SCRUM-40",
        )
        self.assertEqual(plan.warnings, [])
        self.assertEqual([step.kind for step in plan.steps], ["comment"])

    def test_changes_requested_holds_the_status_and_still_comments(self):
        plan = jira_sync.build_plan(
            card("changes_requested", "mex"),
            detail("changes_requested", "mex", "two defects", run_status="changes_requested"),
            jira_state("In Progress", MEX),
            IDENTITIES,
            "SCRUM-40",
        )
        self.assertEqual(plan.warnings, [])
        self.assertEqual([step.kind for step in plan.steps], ["comment"])
        self.assertIn("two defects", plan.steps[0].value)


class TestWhichIssueACardOwns(unittest.TestCase):
    """A declaration decides; then the body; the comments only when the body says nothing.

    The bug: first-key-wins over body + every comment meant a status comment that *mentioned*
    SCRUM-40 moved the CI card onto SCRUM-40, so two cards owned one issue and the CI card would have
    driven a finished ticket back to *To Do*.
    """

    def test_the_body_decides_even_when_a_comment_names_another_ticket(self):
        resolution = jira_sync.resolve_key(
            detail(body="Task: SCRUM-18", comments=["picked this up from the SCRUM-40 bootstrap"])
        )
        self.assertEqual(resolution.key, "SCRUM-18")
        self.assertFalse(resolution.ambiguous)

    def test_a_declared_ticket_outranks_tickets_the_body_merely_mentions(self):
        resolution = jira_sync.resolve_key(detail(
            body="Task: SCRUM-40 https://lebeker.atlassian.net/browse/SCRUM-40\n"
                 "Read SCRUM-40 and SCRUM-41 in full; E01 is SCRUM-41.",
        ))
        self.assertEqual(resolution.key, "SCRUM-40")
        self.assertFalse(resolution.ambiguous)

    def test_two_declarations_are_ambiguous(self):
        resolution = jira_sync.resolve_key(detail(body="Task: SCRUM-40\nTask: SCRUM-41"))
        self.assertIsNone(resolution.key)
        self.assertTrue(resolution.ambiguous)
        self.assertIn("declares 2 tickets", resolution.problem)

    def test_comments_are_the_fallback_when_the_body_names_no_ticket(self):
        resolution = jira_sync.resolve_key(detail(body="no ticket here", comments=["see SCRUM-18"]))
        self.assertEqual(resolution.key, "SCRUM-18")
        self.assertFalse(resolution.ambiguous)

    def test_two_undeclared_tickets_in_the_body_are_ambiguous_not_first_wins(self):
        resolution = jira_sync.resolve_key(detail(body="this covers SCRUM-18 and SCRUM-19"))
        self.assertIsNone(resolution.key)
        self.assertTrue(resolution.ambiguous)
        self.assertIn("SCRUM-18", resolution.problem)
        self.assertIn("SCRUM-19", resolution.problem)
        self.assertIn("Task: <ticket>", resolution.problem)

    def test_two_tickets_in_the_comments_when_the_body_has_none_are_ambiguous(self):
        resolution = jira_sync.resolve_key(detail(body="no ticket", comments=["needs SCRUM-18", "or SCRUM-19"]))
        self.assertIsNone(resolution.key)
        self.assertTrue(resolution.ambiguous)

    def test_one_body_key_silences_a_contested_comment_trail(self):
        resolution = jira_sync.resolve_key(
            detail(body="Task: SCRUM-40", comments=["SCRUM-18 is blocked", "SCRUM-41 is next"])
        )
        self.assertEqual(resolution.key, "SCRUM-40")
        self.assertFalse(resolution.ambiguous)

    def test_a_card_with_no_ticket_anywhere_is_simply_unmapped(self):
        resolution = jira_sync.resolve_key(detail(body="no ticket", comments=["none here either"]))
        self.assertIsNone(resolution.key)
        self.assertFalse(resolution.ambiguous)


class TestOneIssueOneCard(unittest.TestCase):
    """Two cards that resolve to one issue: neither writes, and the exit code says so."""

    def _run(self, rows: list[tuple[str, str, dict]], strict: bool = False):
        client = FakeClient(status="In Progress", assignee_id=MEX)
        details = {card_id: detail for card_id, _, detail in rows}
        code = jira_sync.run(
            apply=True,
            strict=strict,
            cards=[card(state, "mex", card_id) for card_id, state, _ in rows],
            detail_of=lambda card_id: details[card_id],
            client=client,
            identities=IDENTITIES,
            log=lambda _: None,
        )
        return code, client

    def test_two_cards_on_one_issue_both_skip_the_write(self):
        code, client = self._run([
            ("t_a", "ready", detail("ready", "mex", body="Task: SCRUM-40")),
            ("t_b", "running", detail("running", "mex", body="came out of SCRUM-40")),
        ])
        self.assertEqual(client.calls, [])
        self.assertEqual(code, 0)

    def test_a_contested_issue_is_a_warning_under_strict(self):
        code, client = self._run([
            ("t_a", "ready", detail("ready", "mex", body="Task: SCRUM-40")),
            ("t_b", "running", detail("running", "mex", body="came out of SCRUM-40")),
        ], strict=True)
        self.assertEqual(client.calls, [])
        self.assertEqual(code, 1)

    def test_an_archived_card_does_not_stop_the_live_card(self):
        # Two archived decomposer cards once named SCRUM-41 and silenced the real card's sync:
        # a card out of the flow must not claim an issue.
        code, client = self._run([
            ("t_gone", "archived", detail("archived", "mex", body="Task: SCRUM-41")),
            ("t_live", "running", detail("running", "mex", body="Task: SCRUM-41")),
        ])
        self.assertEqual(code, 0)
        self.assertIn("comment", [call[0] for call in client.calls])

    def test_an_ambiguous_card_does_not_stop_the_clean_one(self):
        code, client = self._run([
            ("t_a", "ready", detail("ready", "mex", body="this card covers SCRUM-18 and SCRUM-19")),
            ("t_b", "running", detail("running", "mex", body="Task: SCRUM-40")),
        ])
        self.assertEqual(code, 0)
        self.assertEqual([call[0] for call in client.calls], ["comment"])


class TestTheBugThisFixIsFor(unittest.TestCase):
    """`review` and `blocked` keep the status at *In Progress*; the comment is the whole point."""

    def test_blocked_comments_even_though_the_status_does_not_move(self):
        plan = jira_sync.build_plan(
            card("blocked", "lia"),
            detail("blocked", "lia", block_reason="waiting on schema", run_status="blocked"),
            jira_state("In Progress"),
            IDENTITIES,
            "SCRUM-15",
        )
        self.assertEqual([step.kind for step in plan.steps], ["comment"])
        self.assertIn("waiting on schema", plan.steps[0].value)

    def test_review_comments_even_though_the_status_does_not_move(self):
        plan = jira_sync.build_plan(
            card("review", "lia"),
            detail("review", "lia", "PR #7 ready", run_status="done"),
            jira_state("In Progress"),
            IDENTITIES,
            "SCRUM-15",
        )
        self.assertEqual([step.kind for step in plan.steps], ["comment"])
        self.assertIn("PR #7 ready", plan.steps[0].value)

    def test_a_running_card_does_not_quote_yesterdays_block(self):
        plan = jira_sync.build_plan(
            card("running", "mex"),
            detail("running", "mex", "blocked on admin access", run_status="blocked"),
            jira_state("To Do", MEX),
            IDENTITIES,
            "SCRUM-40",
        )
        comment = [step.value for step in plan.steps if step.kind == "comment"][0]
        self.assertNotIn("blocked on admin access", comment)
        self.assertIn("In progress", comment)

    def test_the_same_review_summary_is_not_posted_twice(self):
        first = jira_sync.build_plan(card("review", "lia"), detail("review", "lia", "PR #7 ready", run_status="done"), jira_state("In Progress"), IDENTITIES, "SCRUM-15")
        marker = first.steps[0].note
        second = jira_sync.build_plan(
            card("review", "lia"),
            detail("review", "lia", "PR #7 ready", run_status="done"),
            jira_state("In Progress", comments=f"... {marker} ..."),
            IDENTITIES,
            "SCRUM-15",
        )
        self.assertEqual(second.steps, [])

    def test_a_new_block_reason_posts_again(self):
        first = jira_sync.build_plan(card("blocked", "lia"), detail("blocked", "lia", block_reason="needs a decision", run_status="blocked"), jira_state("In Progress"), IDENTITIES, "SCRUM-15")
        marker = first.steps[0].note
        second = jira_sync.build_plan(
            card("blocked", "lia"),
            detail("blocked", "lia", block_reason="needs a different decision", run_status="blocked"),
            jira_state("In Progress", comments=marker),
            IDENTITIES,
            "SCRUM-15",
        )
        self.assertEqual([step.kind for step in second.steps], ["comment"])


class TestAssignment(unittest.TestCase):
    def test_a_known_profile_is_assigned(self):
        plan = jira_sync.build_plan(card("running", "mex"), detail("running", "mex"), jira_state("In Progress"), IDENTITIES, "SCRUM-40")
        self.assertEqual(plan.steps[0].kind, "assign")
        self.assertEqual(plan.steps[0].value, MEX)

    def test_an_unknown_account_id_is_a_warning_not_a_guess(self):
        plan = jira_sync.build_plan(card("running", "lia"), detail("running", "lia"), jira_state("In Progress"), IDENTITIES, "SCRUM-15")
        self.assertEqual([step.kind for step in plan.steps if step.kind == "assign"], [])
        self.assertTrue(any("lia" in warning for warning in plan.warnings))

    def test_an_already_correct_assignee_is_not_rewritten(self):
        plan = jira_sync.build_plan(card("running", "mex"), detail("running", "mex"), jira_state("In Progress", MEX), IDENTITIES, "SCRUM-40")
        self.assertEqual([step.kind for step in plan.steps if step.kind == "assign"], [])


class TestReadBack(unittest.TestCase):
    def test_a_write_that_did_not_land_is_a_failure(self):
        plan = jira_sync.Plan("t_1", "running", "SCRUM-15", [jira_sync.Step(jira_sync.STEP_TRANSITION, "In Progress")])
        client = FakeClient(status="To Do", ignore={"transition"})
        self.assertFalse(jira_sync.apply_plan(client, plan, log=lambda _: None))

    def test_a_comment_that_did_not_land_is_a_failure(self):
        marker, body = jira_sync.comment_for(detail("blocked", "lia", block_reason="stuck", run_status="blocked"), "blocked")
        plan = jira_sync.Plan("t_1", "blocked", "SCRUM-15", [jira_sync.Step(jira_sync.STEP_COMMENT, body, note=marker)])
        client = FakeClient(ignore={"comment"})
        self.assertFalse(jira_sync.apply_plan(client, plan, log=lambda _: None))

    def test_every_write_that_lands_is_a_success(self):
        marker, body = jira_sync.comment_for(detail("review", "mex", "PR #7", run_status="done"), "review")
        plan = jira_sync.Plan(
            "t_1",
            "review",
            "SCRUM-40",
            [
                jira_sync.Step(jira_sync.STEP_ASSIGN, MEX),
                jira_sync.Step(jira_sync.STEP_TRANSITION, "In Progress"),
                jira_sync.Step(jira_sync.STEP_COMMENT, body, note=marker),
            ],
        )
        client = FakeClient(status="To Do")
        self.assertTrue(jira_sync.apply_plan(client, plan, log=lambda _: None))
        self.assertEqual(client.status, "In Progress")
        self.assertEqual(client.assignee_id, MEX)
        self.assertIn(marker, client.comments)


class TestDoneGate(unittest.TestCase):
    """Jira Done says "this reached main". Only evidence says that, and there is no way back out of Done.

    The live defect: `t_5c1a18ff` was closed done at 00:15 on 2026-11-22 while PR #8 was still OPEN with
    zero reviews, and the 00:25 sync would have written SCRUM-12 Done. Two more instances the same
    night: `t_8f2dc183` (SCRUM-13) written Done with no PR at all, and `t_2702f269` (SCRUM-35) dragged
    back from In Progress to To Do.
    """

    def done_plan(self, evidence, jira_status="In Progress", comments=()):
        rows = [comments] if isinstance(comments, str) else list(comments)
        return jira_sync.build_plan(
            card("done", "mex"),
            detail("done", "mex", "closed out", comments=rows),
            jira_state(jira_status, MEX, "".join(rows)),
            IDENTITIES,
            "SCRUM-1",
            evidence=evidence,
        )

    def test_done_with_an_open_pr_writes_no_done(self):
        evidence = gate([pull_request(8, "OPEN")])
        self.assertFalse(evidence.ok)
        self.assertEqual(evidence.token, "pending-merge")

        plan = self.done_plan(evidence)
        self.assertEqual([step.kind for step in plan.steps], ["comment"])
        self.assertEqual(plan.holds[0][:13], "pending-merge")
        self.assertIn("OPEN", plan.steps[0].value)

    def test_done_with_a_merged_pr_writes_done(self):
        evidence = gate([pull_request(8, "MERGED", MERGED_SHA)])
        self.assertEqual(evidence.kind, "merged-pr")

        plan = self.done_plan(evidence)
        self.assertEqual([step.kind for step in plan.steps], ["transition", "comment"])
        self.assertEqual(plan.steps[0].value, "Done")
        self.assertEqual(plan.holds, [])
        self.assertIn(MERGED_SHA[:9], plan.steps[1].value)

    def test_done_with_a_closed_unmerged_pr_writes_nothing(self):
        evidence = gate([pull_request(8, "CLOSED")])
        self.assertEqual(evidence.token, "no-merge-evidence")
        self.assertIn("CLOSED without being merged", evidence.reason)
        plan = self.done_plan(evidence)
        self.assertEqual([step.kind for step in plan.steps], ["comment"])
        self.assertIn("CLOSED without being merged", plan.steps[0].value)

    def test_a_closed_pr_does_not_block_a_valid_no_change_needed(self):
        # Live: `t_7bcec2ed` (SCRUM-68). PR #59 was closed rather than merged while the regeneration
        # landed on main as f8f8485, and the card declared exactly that — but the closed PR was read
        # first, so the card could never be mirrored.
        row = detail("done", "mex", comments=[f"no-change-needed: {MERGED_SHA}"])
        evidence = gate([pull_request(59, "CLOSED")], row)
        self.assertEqual(evidence.kind, "no-change-needed")
        self.assertEqual(evidence.commit, MERGED_SHA)

        plan = self.done_plan(evidence, comments=[f"no-change-needed: {MERGED_SHA}"])
        self.assertEqual([step.kind for step in plan.steps], ["transition", "comment"])
        self.assertEqual(plan.steps[0].value, "Done")
        self.assertEqual(plan.holds, [])

    def test_a_closed_pr_and_a_declared_commit_off_main_is_unverifiable(self):
        row = detail("done", "mex", comments=[f"no-change-needed: {ELSEWHERE}"])
        evidence = gate([pull_request(59, "CLOSED")], row)
        self.assertEqual(evidence.token, "unverifiable")
        self.assertIn(ELSEWHERE[:9], evidence.reason)

    def test_an_open_pr_still_holds_the_card_against_a_declaration(self):
        # A PR that is still open is the one case where the card cannot be done: it may still merge,
        # and the declaration is the escape hatch for work that landed *elsewhere*, not for this.
        row = detail("done", "mex", comments=[f"no-change-needed: {MERGED_SHA}"])
        evidence = gate([pull_request(8, "OPEN")], row)
        self.assertEqual(evidence.token, "pending-merge")

    def test_a_merged_pr_whose_commit_is_not_on_main_is_not_evidence(self):
        evidence = gate([pull_request(8, "MERGED", ELSEWHERE)])
        self.assertEqual(evidence.token, "unverifiable")
        plan = self.done_plan(evidence)
        self.assertEqual([step.kind for step in plan.steps], ["comment"])
        self.assertIn("not reachable from origin/main", plan.steps[0].value)

    def test_done_with_no_pr_and_a_declared_commit_on_main_writes_done(self):
        row = detail("done", "mex", comments=[f"no-change-needed: {MERGED_SHA}\n\napp.json already carried id health-viewer"])
        evidence = gate([], row)
        self.assertEqual(evidence.kind, "no-change-needed")

        plan = self.done_plan(evidence)
        self.assertEqual([step.kind for step in plan.steps], ["transition", "comment"])
        self.assertEqual(plan.steps[0].value, "Done")
        self.assertIn("no-change-needed", plan.steps[1].value)

    def test_a_declared_commit_that_is_not_on_main_writes_nothing(self):
        row = detail("done", "mex", comments=[f"no-change-needed: {ELSEWHERE}"])
        evidence = gate([], row)
        self.assertEqual(evidence.token, "unverifiable")
        plan = self.done_plan(evidence)
        self.assertEqual([step.kind for step in plan.steps], ["comment"])

    def test_a_commit_mentioned_in_prose_is_not_a_declaration(self):
        # "the acceptance was already satisfied in 30d65bb" is an inference, not a declaration: the
        # third allowed case has to be deliberate, or a Done write becomes a matter of reading intent.
        row = detail("done", "mex", comments=["the acceptance was already satisfied in 30d65bb, see PR #1"])
        evidence = gate([], row)
        self.assertEqual(evidence.token, "no-merge-evidence")
        self.assertIn("no-change-needed", evidence.reason)

    def test_two_different_declarations_are_ambiguous_not_a_choice(self):
        row = detail("done", "mex", comments=[f"no-change-needed: {MERGED_SHA}",
                                              f"no-change-needed: {ELSEWHERE}"])
        evidence = gate([], row)
        self.assertEqual(evidence.token, "no-merge-evidence")
        self.assertIn("2 different no-change-needed commits", evidence.reason)

    def test_no_pr_and_no_declaration_refuses(self):
        evidence = gate([], detail("done", "mex"), branch="fix/SCRUM-1_gate")
        self.assertEqual(evidence.token, "no-merge-evidence")
        self.assertIn("Task: t_1", evidence.reason)
        self.assertIn("fix/SCRUM-1_gate", evidence.reason)

    def test_the_pr_is_found_by_branch_when_the_body_does_not_name_the_card(self):
        evidence = gate(
            [pull_request(9, "MERGED", MERGED_SHA, branch="fix/SCRUM-1_gate", body="no trailer here")],
            branch="fix/SCRUM-1_gate",
        )
        self.assertEqual(evidence.kind, "merged-pr")
        self.assertEqual(evidence.pr_number, 9)

    def test_the_pr_is_found_by_a_body_that_opens_with_the_card_id(self):
        # Every card's branch is renamed off `wt/` before its first push, so the body trailer is the
        # only link that survives; it must work even when the branch on GitHub is unrecognisable.
        evidence = gate([pull_request(9, "MERGED", MERGED_SHA, branch="feat/SCRUM-1_something", body="Task: t_1\n\nWhat")])
        self.assertEqual(evidence.kind, "merged-pr")

    def test_a_body_that_mentions_the_card_id_later_does_not_count(self):
        evidence = gate([pull_request(9, "MERGED", MERGED_SHA, body="## Notes\n\nTask: t_1\n")])
        self.assertEqual(evidence.token, "no-merge-evidence")

    def test_a_merged_pr_beats_a_closed_one_for_the_same_card(self):
        evidence = gate([pull_request(4, "CLOSED"), pull_request(9, "MERGED", MERGED_SHA)])
        self.assertEqual(evidence.kind, "merged-pr")
        self.assertEqual(evidence.pr_number, 9)

    def test_a_done_card_already_in_done_is_not_touched_by_the_gate(self):
        # The gate guards a *write*. 12 cards closed on main in one night must not each collect a
        # "no merge evidence" comment on an issue that already says Done.
        plan = self.done_plan(gate([pull_request(8, "OPEN")]), jira_status="Done")
        self.assertEqual([step.kind for step in plan.steps], ["comment"])
        self.assertEqual(plan.holds, [])

    def test_a_hold_is_commented_once(self):
        first = self.done_plan(gate([pull_request(8, "OPEN")]))
        marker = first.steps[0].note
        second = self.done_plan(gate([pull_request(8, "OPEN")]), comments=marker)
        self.assertEqual(second.steps, [])
        self.assertEqual(len(second.holds), 1)

    def test_a_done_card_with_no_evidence_at_all_fails_closed(self):
        plan = self.done_plan(None)
        self.assertEqual([step.kind for step in plan.steps], ["comment"])
        self.assertTrue(plan.holds[0].startswith("no-merge-evidence"))


class TestFindingThePrOfARealCard(unittest.TestCase):
    """A live card's link to its PR is either a real branch name or the PR's own first line.

    The defect this class pins: the PR-body fallback matched `Task: <card-id>` only, while every PR
    that follows the delivery rules opens with `Task: <jira-key>` (16 of 18 in the repo). On top of
    that, `tasks.branch_name` still holds the unpushable `wt/` seed on 15 of 18 cards, because nothing
    tells the board when a worker renames its branch before the first push. The fallback therefore
    matched nothing for the cards it existed for, and the gate read a merged card as having no PR —
    which refuses a Done that all the evidence supports, and there is no way back out of Done.
    """

    def test_a_wt_seed_is_never_the_branch_to_ask_github_about(self):
        row = detail("done", "mex", branch_name="wt/t16-lee-index-frailty",
                     body="Task: SCRUM-27\nRequired branch: feat/SCRUM-27_lee-index")
        self.assertEqual(jira_sync.branches_of(row), ["feat/SCRUM-27_lee-index"])

    def test_a_recorded_branch_is_used_as_it_stands(self):
        row = detail("done", "mex", branch_name="feat/SCRUM-27_lee-index",
                     body="Task: SCRUM-27\nRequired branch: fix/SCRUM-27_other")
        self.assertEqual(jira_sync.branches_of(row), ["feat/SCRUM-27_lee-index"])

    def test_a_pr_that_opens_with_the_jira_key_is_this_card(self):
        self.assertTrue(jira_sync.declares_card(pull_request(18, "OPEN", body="Task: SCRUM-27\n\nWhat"), "t_53b40a9a", "SCRUM-27"))

    def test_a_pr_that_opens_with_the_card_id_is_still_this_card(self):
        # PR #1 and #2 predate the convention; dropping this form would lose them.
        self.assertTrue(jira_sync.declares_card(pull_request(1, "OPEN", body="Task: t_1\n"), "t_1", "SCRUM-27"))

    def test_a_pr_that_opens_with_another_card_is_not_this_card(self):
        self.assertFalse(jira_sync.declares_card(pull_request(18, "OPEN", body="Task: SCRUM-99"), "t_1", "SCRUM-27"))
        self.assertFalse(jira_sync.declares_card(pull_request(18, "OPEN", body="Task: t_9"), "t_1", "SCRUM-27"))

    def test_a_stale_wt_branch_and_a_key_opener_resolve_a_merged_pr(self):
        row = detail("done", "mex", branch_name="wt/t16-lee-index-frailty", body="Task: SCRUM-27")
        evidence = gate(
            [pull_request(18, "MERGED", MERGED_SHA, branch="feat/SCRUM-27_lee-index", body="Task: SCRUM-27\n\nBody")],
            row, key="SCRUM-27",
        )
        self.assertEqual(evidence.kind, "merged-pr")
        self.assertEqual(evidence.pr_number, 18)

    def test_a_stale_wt_branch_and_a_key_opener_hold_an_open_pr(self):
        row = detail("done", "mex", branch_name="wt/t16-lee-index-frailty", body="Task: SCRUM-27")
        evidence = gate(
            [pull_request(18, "OPEN", branch="feat/SCRUM-27_lee-index", body="Task: SCRUM-27\n\nBody")],
            row, key="SCRUM-27",
        )
        self.assertEqual(evidence.token, "pending-merge")
        self.assertEqual(evidence.pr_number, 18)
        plan = jira_sync.build_plan(
            card("done", "mex"), row, jira_state("In Progress", MEX), IDENTITIES, "SCRUM-27", evidence=evidence,
        )
        self.assertEqual([step.kind for step in plan.steps], ["comment"])
        self.assertTrue(plan.holds[0].startswith("pending-merge"))

    def test_a_wt_branch_still_resolves_through_the_card_body_when_the_pr_body_is_uninformative(self):
        # The card declares its own branch, which is the strongest link it can give when neither the
        # board's record nor the PR's first line says anything usable.
        row = detail("done", "mex", branch_name="wt/t01-demo", body="Task: SCRUM-1\nRequired branch: fix/SCRUM-1_gate")
        evidence = gate([pull_request(9, "MERGED", MERGED_SHA, branch="fix/SCRUM-1_gate", body="no trailer here")], row)
        self.assertEqual(evidence.kind, "merged-pr")
        self.assertEqual(evidence.pr_number, 9)

    def test_nothing_matching_at_all_still_names_both_openers(self):
        evidence = gate([], detail("done", "mex", branch_name="wt/t01-demo", body="Task: SCRUM-1"), key="SCRUM-1")
        self.assertEqual(evidence.token, "no-merge-evidence")
        self.assertIn("Task: t_1", evidence.reason)
        self.assertIn("Task: SCRUM-1", evidence.reason)
        self.assertIn("no branch recorded", evidence.reason)
        self.assertIn("a title naming SCRUM-1", evidence.reason)

    def test_a_successful_verdict_does_not_log_itself_as_a_refusal(self):
        # `token` is empty on success, and the run log used to fall back to `no-merge-evidence`.
        line = gate([pull_request(8, "MERGED", MERGED_SHA)]).log_line()
        self.assertTrue(line.startswith("merged-pr: "), line)

    def test_a_resolver_that_times_out_holds_the_card_instead_of_killing_the_run(self):
        # A slow `gh` must cost one card's evidence, not the whole board's sync.
        def boom(_card, _detail):
            raise subprocess.TimeoutExpired("gh pr list", 180)

        client = FakeClient(status="In Progress", assignee_id=MEX)
        log = []
        code = jira_sync.run(
            apply=True, strict=False, cards=[card("done", "mex")],
            detail_of=lambda _: detail("done", "mex", "closed out"),
            client=client, identities=IDENTITIES, log=log.append, evidence_of=boom,
        )
        self.assertEqual(code, 0)
        self.assertEqual(client.status, "In Progress")
        self.assertEqual([call for call in client.calls if call[0] == "transition"], [])
        self.assertTrue(any("timed out" in line for line in log), log)


class TestScratchCardsBindTheirPrByTitle(unittest.TestCase):
    """A `scratch` card records no branch, so the PR title is the only link it has.

    Three live cards needed a hand-written `no-change-needed` line because of it: SCRUM-46 (PR #31 →
    a24f788), SCRUM-60 (PR #47 → 530c9c5) and SCRUM-65 (PR #54 → 72ffcbd). Every PR title in this
    repo names its ticket the way every branch name and squash commit does, so binding on the title
    is reading the convention that is already there rather than inventing a new one.
    """

    def scratch(self, body: str = "Task: SCRUM-46") -> dict:
        return detail("done", "mex", body=body)

    def test_a_merged_pr_whose_title_names_the_ticket_writes_done(self):
        for key, number, sha, title in (
            ("SCRUM-46", 31, MERGED_SHA, "SCRUM-46 — graph view: fit by measurement, place labels by measurement"),
            ("SCRUM-60", 47, MERGED_SHA, "SCRUM-60 — ci-gate: a missing head/base is a usage error (#47)"),
            ("SCRUM-65", 54, MERGED_SHA, "SCRUM-65 — profile view: the blocks v11d names (#54)"),
        ):
            with self.subTest(key=key):
                evidence = jira_sync.evaluate_merge_gate(
                    "t_1", self.scratch(f"Task: {key}"),
                    [pull_request(number, "MERGED", sha, branch="", body="no trailer here", title=title)],
                    lambda sha: sha == MERGED_SHA, branch=[], key=key,
                )
                self.assertEqual(evidence.kind, "merged-pr", evidence.log_line())
                self.assertEqual(evidence.pr_number, number)

    def test_the_card_is_written_done_through_the_plan_with_no_declaration(self):
        row = self.scratch()
        evidence = jira_sync.evaluate_merge_gate(
            "t_1", row, [pull_request(31, "MERGED", MERGED_SHA, body="no trailer", title="SCRUM-46 — graph view")],
            lambda sha: sha == MERGED_SHA, branch=[], key="SCRUM-46",
        )
        plan = jira_sync.build_plan(card("done", "mex"), row, jira_state("In Progress", MEX), IDENTITIES,
                                    "SCRUM-46", evidence=evidence)
        self.assertEqual([step.kind for step in plan.steps], ["transition", "comment"])
        self.assertEqual(plan.steps[0].value, "Done")
        self.assertEqual(plan.holds, [])

    def test_an_open_pr_found_by_title_holds_the_card(self):
        evidence = jira_sync.evaluate_merge_gate(
            "t_1", self.scratch(), [pull_request(31, "OPEN", title="SCRUM-46 — graph view")],
            lambda sha: False, branch=[], key="SCRUM-46",
        )
        self.assertEqual(evidence.token, "pending-merge")
        self.assertEqual(evidence.pr_number, 31)

    def test_a_title_naming_a_neighbouring_ticket_does_not_bind(self):
        # SCRUM-4 and SCRUM-460 are different tickets; a substring match would hand one card another
        # card's merge, which is the mistake this gate exists to refuse.
        for title in ("SCRUM-460 — something else", "fix SCRUM-4 rendering", "no ticket in this title"):
            with self.subTest(title=title):
                evidence = jira_sync.evaluate_merge_gate(
                    "t_1", self.scratch(), [pull_request(31, "MERGED", MERGED_SHA, body="no trailer", title=title)],
                    lambda sha: sha == MERGED_SHA, branch=[], key="SCRUM-46",
                )
                self.assertEqual(evidence.token, "no-merge-evidence", evidence.log_line())

    def test_a_ticket_named_later_in_a_title_is_context_not_a_claim(self):
        # PR #59's own title is "fix(SCRUM-68): rebuild the published case page from SCRUM-67's
        # template". Reading the second ticket out of that prose would bind SCRUM-67's card to a PR
        # that is not its own, so only the first ticket named counts.
        pr = pull_request(59, "CLOSED", title="fix(SCRUM-68): rebuild the published case page from SCRUM-67's template")
        self.assertFalse(jira_sync.ticket_in_title(pr, "SCRUM-67"))
        self.assertTrue(jira_sync.ticket_in_title(pr, "SCRUM-68"))

    def test_a_title_only_counts_for_the_card_that_owns_the_ticket(self):
        self.assertTrue(jira_sync.ticket_in_title(pull_request(31, "MERGED", title="SCRUM-46 — graph"), "SCRUM-46"))
        self.assertFalse(jira_sync.ticket_in_title(pull_request(31, "MERGED", title="SCRUM-46 — graph"), "SCRUM-4"))
        self.assertFalse(jira_sync.ticket_in_title(pull_request(31, "MERGED", title="SCRUM-46 — graph"), ""))

    def test_the_key_may_sit_inside_the_conventional_prefix(self):
        # Titles are written by agents and humans: `fix(SCRUM-60): …`, `chore: … (SCRUM-45)` and
        # `SCRUM-46 — …` all name the same ticket. Position does not decide; the first ticket does.
        for title in ("fix(SCRUM-60): a missing head/base is a usage error",
                      "SCRUM-60 — ci-gate: a missing head/base is a usage error",
                      "chore(body): QA drivers refuse a host browser (SCRUM-60)"):
            with self.subTest(title=title):
                self.assertTrue(jira_sync.ticket_in_title(pull_request(47, "MERGED", title=title), "SCRUM-60"))


class TestStatusNeverMovesBackwards(unittest.TestCase):
    """The board flaps; the ledger must not follow it down.

    Live defect: `t_2702f269` (SCRUM-35) was In Progress, went blocked, then ready when the block was
    lifted with a decision — and the sync wrote In Progress -> To Do on a card with an open PR. The
    rework path `running -> review -> running` would do the same on every cycle.
    """

    def test_a_ready_card_does_not_drag_in_progress_back_to_to_do(self):
        plan = jira_sync.build_plan(card("ready", "mex"), detail("ready", "mex"), jira_state("In Progress", MEX), IDENTITIES, "SCRUM-1")
        self.assertEqual([step.kind for step in plan.steps], ["comment"])
        self.assertTrue(plan.holds[0].startswith("status-not-moved-backwards"))
        self.assertIn("In Progress", plan.holds[0])

    def test_a_running_card_does_not_drag_a_done_issue_back(self):
        plan = jira_sync.build_plan(card("running", "mex"), detail("running", "mex"), jira_state("Done", MEX), IDENTITIES, "SCRUM-1")
        self.assertEqual([step.kind for step in plan.steps], ["comment"])
        self.assertTrue(plan.holds[0].startswith("status-not-moved-backwards"))

    def test_the_rework_flap_moves_the_status_once(self):
        client = FakeClient(status="To Do", assignee_id=MEX)
        log = []
        for state in ("running", "ready", "running"):
            jira_sync.run(
                apply=True,
                strict=False,
                cards=[card(state, "mex")],
                detail_of=lambda card_id, state=state: detail(state, "mex"),
                client=client,
                identities=IDENTITIES,
                log=log.append,
            )
        transitions = [call for call in client.calls if call[0] == "transition"]
        self.assertEqual(transitions, [("transition", "In Progress")])
        self.assertEqual(client.status, "In Progress")
        self.assertTrue(any("status-not-moved-backwards" in line for line in log))


class TestRunLoop(unittest.TestCase):
    def _run(self, cards, client, apply=True, strict=False):
        # The card is the source of both state and owner, so the fake detail is built from it.
        details = {c["id"]: detail(c["status"], c["assignee"]) for c in cards}
        return jira_sync.run(
            apply=apply,
            strict=strict,
            cards=cards,
            detail_of=lambda card_id: details[card_id],
            client=client,
            identities=IDENTITIES,
            log=lambda _: None,
        )

    def test_a_card_without_a_jira_key_is_skipped_without_failing(self):
        code = jira_sync.run(
            apply=True,
            strict=False,
            cards=[card("running", "mex")],
            detail_of=lambda _: detail(body="no ticket here"),
            client=FakeClient(),
            identities=IDENTITIES,
            log=lambda _: None,
        )
        self.assertEqual(code, 0)

    def test_dry_run_writes_nothing(self):
        client = FakeClient(status="To Do")
        self._run([card("running", "mex")], client, apply=False)
        self.assertEqual(client.calls, [])
        self.assertEqual(client.status, "To Do")

    def test_strict_turns_a_mapping_warning_into_a_non_zero_exit(self):
        client = FakeClient(status="To Do")
        self.assertEqual(self._run([card("running", "lia")], client, strict=False), 0)
        self.assertEqual(self._run([card("running", "lia")], client, strict=True), 1)

    def test_a_failed_write_exits_non_zero(self):
        client = FakeClient(status="To Do", ignore={"transition"})
        self.assertEqual(self._run([card("running", "mex")], client), 1)

    def test_the_run_log_names_a_card_waiting_on_a_merge(self):
        client = FakeClient(status="In Progress", assignee_id=MEX)
        log = []
        code = jira_sync.run(
            apply=True,
            strict=False,
            cards=[card("done", "mex")],
            detail_of=lambda _: detail("done", "mex", "closed out"),
            client=client,
            identities=IDENTITIES,
            log=log.append,
            evidence_of=lambda _card, _detail: gate([pull_request(8, "OPEN")]),
        )
        self.assertEqual(code, 0)
        self.assertTrue(any(line.strip().split(" — ")[-1].startswith("pending-merge") for line in log), log)
        self.assertEqual([call for call in client.calls if call[0] == "transition"], [])
        self.assertEqual(client.status, "In Progress")

    def test_a_done_card_writes_done_through_the_loop_only_with_merged_evidence(self):
        client = FakeClient(status="In Progress", assignee_id=MEX)
        code = jira_sync.run(
            apply=True,
            strict=False,
            cards=[card("done", "mex")],
            detail_of=lambda _: detail("done", "mex", "closed out"),
            client=client,
            identities=IDENTITIES,
            log=lambda _: None,
            evidence_of=lambda _card, _detail: gate([pull_request(8, "MERGED", MERGED_SHA)]),
        )
        self.assertEqual(code, 0)
        self.assertEqual(client.status, "Done")

    def test_a_done_card_without_a_resolver_fails_closed(self):
        client = FakeClient(status="In Progress", assignee_id=MEX)
        log = []
        code = jira_sync.run(
            apply=True,
            strict=False,
            cards=[card("done", "mex")],
            detail_of=lambda _: detail("done", "mex", "closed out"),
            client=client,
            identities=IDENTITIES,
            log=log.append,
        )
        self.assertEqual(code, 0)
        self.assertEqual([call for call in client.calls if call[0] == "transition"], [])
        self.assertEqual(client.status, "In Progress")
        self.assertTrue(any("no-merge-evidence" in line for line in log), log)

    def test_a_genuinely_unmirrorable_card_is_a_refusal_and_exits_zero(self):
        # A card the ledger cannot mirror yet is not a broken ledger: nothing was written, and the
        # exit code is what the cron turns into an alert. It reports transport and write trouble only,
        # so one unmirrorable card cannot turn a healthy sync into a red 15-minute tick.
        for strict in (False, True):
            with self.subTest(strict=strict):
                client = FakeClient(status="In Progress", assignee_id=MEX)
                log = []
                code = jira_sync.run(
                    apply=True,
                    strict=strict,
                    cards=[card("done", "mex")],
                    detail_of=lambda _: detail("done", "mex", "closed out", body="Task: SCRUM-46"),
                    client=client,
                    identities=IDENTITIES,
                    log=log.append,
                    evidence_of=lambda _card, _detail: gate([], detail("done", "mex", body="Task: SCRUM-46"),
                                                            key="SCRUM-46"),
                )
                self.assertEqual(code, 0)
                self.assertEqual([call for call in client.calls if call[0] == "transition"], [])
                held = [line for line in log if "no-merge-evidence" in line]
                self.assertTrue(held, log)
                self.assertIn("refusal", held[0])
                self.assertTrue(any("1 refusal(s)" in line for line in log), log)
                self.assertTrue(any("0 failure(s)" in line for line in log), log)

    def test_a_transport_failure_still_exits_non_zero(self):
        # The other half of the rule: a refusal is quiet, an unreadable issue is not.
        client = FakeClient(status="In Progress", assignee_id=MEX)

        def unreadable(_key):
            raise jira_sync.StepFailed("Timed out waiting for MCP response")

        code = jira_sync.run(
            apply=True, strict=False, cards=[card("running", "mex")],
            detail_of=lambda _: detail("running", "mex"),
            client=type("Broken", (), {"read": staticmethod(unreadable), "set_assignee": lambda *a: None,
                                       "transition": lambda *a: None, "comment": lambda *a: None})(),
            identities=IDENTITIES, log=lambda _: None,
        )
        self.assertEqual(code, 1)


class TestIdentityMap(unittest.TestCase):
    def test_the_committed_map_parses(self):
        mapping = jira_sync.load_identity_map()
        self.assertEqual(mapping.get("mex"), MEX)
        self.assertIn("lia", mapping)

    def test_the_verified_operator_ids_are_recorded(self):
        """The ids were verified in Jira by exact email lookup. A null here is a silent no-op on
        assignment, so the map is pinned rather than trusted."""
        mapping = jira_sync.load_identity_map()
        self.assertEqual(mapping.get("lia"), LIA)
        self.assertEqual(mapping.get("right"), RIGHT)

    def test_a_missing_file_is_an_empty_map_not_a_crash(self):
        self.assertEqual(jira_sync.load_identity_map("/nonexistent/jira-identities.json"), {})


if __name__ == "__main__":
    unittest.main()
