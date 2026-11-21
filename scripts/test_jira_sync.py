#!/usr/bin/env python3
"""Unit tests for the Jira sync's decisions and its read-back, with a fake client.

No network: the point is that a mapping change, a dropped comment or a write that Jira silently
ignores fails here, deterministically, before it reaches a real ticket. CI runs this file.

    python3 -m unittest scripts/test_jira_sync.py -v
"""
from __future__ import annotations

import importlib.util
import os
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
           run_status: str = "running", block_reason: str = "", comments: list[str] | None = None) -> dict:
    return {
        "task": {"id": "t_1", "assignee": assignee, "body": body, "block_reason": block_reason},
        "run": {"status": run_status, "outcome": None, "summary": summary},
        "comments": [{"author": "someone", "body": text} for text in (comments or [])],
    }


def jira_state(status=None, assignee_id=None, comments=""):
    return jira_sync.JiraState(status=status, assignee_id=assignee_id, comments=comments)


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
        plan = jira_sync.build_plan(card("done", "mex"), detail("done", "mex", "merged"), jira_state("In Progress", MEX), IDENTITIES, "SCRUM-1")
        kinds = [step.kind for step in plan.steps]
        self.assertEqual(kinds, ["transition", "comment"])
        self.assertEqual(plan.steps[0].value, "Done")

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
