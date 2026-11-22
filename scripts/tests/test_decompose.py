#!/usr/bin/env python3
"""Unit tests for scripts/decompose.py (GOL-343 / GOL-154).

Zero-dependency stdlib `unittest`. Run:
    python3 scripts/tests/test_decompose.py            # or -v
    python3 -m unittest discover -s scripts/tests
"""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.dirname(HERE)
FIX = os.path.join(HERE, "fixtures")
sys.path.insert(0, SCRIPTS)

import decompose as d  # noqa: E402


def load_real_ownership():
    return {
        "grove-sites": d.load_ownership("grove-sites", os.path.join(FIX, "own_grove-sites.yml"))[0],
        "odoocker": d.load_ownership("odoocker", os.path.join(FIX, "own_odoocker.yml"))[0],
        "grove-odoo-modules": d.load_ownership(
            "grove-odoo-modules", os.path.join(FIX, "own_grove-odoo-modules.yml")
        )[0],
    }


def load_spec(name):
    with open(os.path.join(FIX, name), encoding="utf-8") as fh:
        return d.Spec(d.parse_yaml(fh.read()))


def resolver():
    import json
    with open(os.path.join(FIX, "agents.json"), encoding="utf-8") as fh:
        return d.AgentResolver.from_list(json.load(fh))


# --------------------------------------------------------------------------- #
# Glob matcher (spec §3)
# --------------------------------------------------------------------------- #
class TestGlob(unittest.TestCase):
    def test_globstar_matches_nested(self):
        self.assertTrue(d.glob_match("apps/hub/**", "apps/hub/pages/index.tsx"))
        self.assertTrue(d.glob_match("apps/hub/**", "apps/hub/x"))

    def test_globstar_matches_bare_dir(self):
        # "foo/**" also claims the directory itself.
        self.assertTrue(d.glob_match("apps/hub/**", "apps/hub"))

    def test_globstar_matches_glob_path(self):
        # spec paths may themselves contain "**"
        self.assertTrue(d.glob_match("apps/hub/**", "apps/hub/**"))

    def test_no_prefix_bleed(self):
        # packages/ui must NOT match packages/ui-kit
        self.assertFalse(d.glob_match("packages/ui/**", "packages/ui-kit/**"))
        self.assertFalse(d.glob_match("packages/ui/**", "packages/ui-kit/Button.tsx"))

    def test_single_star_stays_in_segment(self):
        self.assertTrue(d.glob_match("docker-compose.*.yml", "docker-compose.prod.yml"))
        self.assertFalse(d.glob_match("docker-compose.*.yml", "docker-compose.a/b.yml"))

    def test_literal_file(self):
        self.assertTrue(d.glob_match("Makefile", "Makefile"))
        self.assertFalse(d.glob_match("Makefile", "Makefile.bak"))

    def test_specificity_metrics(self):
        self.assertEqual(d.literal_prefix_len("apps/hub/**"), len("apps/hub/"))
        self.assertEqual(d.literal_prefix_len("apps/**"), len("apps/"))
        self.assertEqual(d.wildcard_segment_count("apps/hub/**"), 1)
        self.assertEqual(d.wildcard_segment_count("a/*/b/*"), 2)


# --------------------------------------------------------------------------- #
# Most-specific-wins (spec §3.2)
# --------------------------------------------------------------------------- #
class TestSpecificity(unittest.TestCase):
    def _parts(self):
        # deliberately declare the broad glob FIRST so declaration-order is not
        # what makes the specific one win.
        return [
            d.Partition("r", "broad", ["apps/**"], ["engineering-ada"], ["devops-terra"], 1, 0),
            d.Partition("r", "specific", ["apps/hub/**"], ["frontend-iris"], ["engineering-ada"], 2, 1),
        ]

    def test_longest_literal_prefix_wins(self):
        win = d._pick_partition(self._parts(), "apps/hub/page.tsx")
        self.assertEqual(win.name, "specific")

    def test_broad_only_when_no_specific(self):
        win = d._pick_partition(self._parts(), "apps/other/x")
        self.assertEqual(win.name, "broad")

    def test_declaration_order_breaks_ties(self):
        parts = [
            d.Partition("r", "first", ["src/**"], ["engineering-ada"], ["devops-terra"], 1, 0),
            d.Partition("r", "second", ["src/**"], ["frontend-iris"], ["devops-terra"], 1, 1),
        ]
        self.assertEqual(d._pick_partition(parts, "src/a.ts").name, "first")

    def test_unmapped_returns_none(self):
        self.assertIsNone(d._pick_partition(self._parts(), "totally/novel/path.py"))


# --------------------------------------------------------------------------- #
# End-to-end partitioning of the sample spec against real ownership (spec §8)
# --------------------------------------------------------------------------- #
class TestSampleSpec(unittest.TestCase):
    def setUp(self):
        self.own = load_real_ownership()
        self.spec = load_spec("sample-spec.yml")
        self.emissions, self.unmapped = d.partition_spec(self.spec, self.own)

    def test_exactly_one_unmapped(self):
        self.assertEqual(self.unmapped, [("grove-odoo-modules", "totally/novel/path.py")])

    def test_no_path_double_assigned(self):
        seen = []
        for em in self.emissions.values():
            seen += [(em.repo, p) for p in em.paths]
        self.assertEqual(len(seen), len(set(seen)), "a path was assigned to >1 partition")
        # every input path is accounted for exactly once (mapped xor unmapped)
        total_in = sum(len(ch["paths"]) for ch in self.spec.changes)
        self.assertEqual(len(seen) + len(self.unmapped), total_in)

    def test_partitions_owners_reviewers_waves(self):
        got = {
            k: (em.partition.owners[0], em.partition.reviewers, em.wave)
            for k, em in self.emissions.items()
        }
        self.assertEqual(got["grove-sites/app-hub"], ("frontend-iris", ["engineering-ada"], 2))
        self.assertEqual(got["odoocker/data"], ("devops-terra", ["engineering-ada"], 1))
        self.assertEqual(
            got["grove-odoo-modules/module-grove-headless"], ("engineering-ada", ["devops-terra"], 1)
        )
        self.assertEqual(
            got["grove-odoo-modules/module-web-dark-mode"], ("frontend-iris", ["engineering-ada"], 1)
        )

    def test_owners_span_all_three_agents(self):
        owners = {em.partition.owners[0] for em in self.emissions.values()}
        self.assertEqual(owners, {"engineering-ada", "devops-terra", "frontend-iris"})

    def test_body_carries_idempotency_marker_and_acceptance(self):
        r = resolver()
        em = self.emissions["grove-sites/app-hub"]
        body = d.issue_body(em, self.spec, r)
        self.assertIn(f"decompose:{self.spec.id}:grove-sites:app-hub", body)
        self.assertIn("Smoke: partitioning is correct", body)
        self.assertTrue(d.issue_title(em, self.spec).startswith("[W2][grove-sites/app-hub]"))


class TestLiteralSpec(unittest.TestCase):
    """Documents that the verbatim §8 draft yields THREE unmapped paths."""

    def test_literal_yields_three_unmapped(self):
        own = load_real_ownership()
        spec = load_spec("sample-spec-literal.yml")
        _, unmapped = d.partition_spec(spec, own)
        self.assertEqual(
            sorted(unmapped),
            sorted([
                ("grove-sites", "packages/ui-kit/**"),
                ("odoocker", "addons/**"),
                ("grove-odoo-modules", "totally/novel/path.py"),
            ]),
        )


# --------------------------------------------------------------------------- #
# Owner resolution (spec §5)
# --------------------------------------------------------------------------- #
class TestResolver(unittest.TestCase):
    def test_known_slug(self):
        self.assertEqual(resolver().id_for("engineering-ada"), "72f97c75-99e9-48e5-94ff-d1bd0c6edb1a")

    def test_unknown_slug_hard_errors(self):
        with self.assertRaises(ValueError):
            resolver().id_for("nobody-here")


# --------------------------------------------------------------------------- #
# Apply: wave gate + idempotency (spec §4, §6) via an in-memory fake API
# --------------------------------------------------------------------------- #
class FakeApi:
    def __init__(self):
        self.store = {"umb-1": {"id": "umb-1", "identifier": "GOL-154", "children": []}}
        self._n = 0

    def get(self, path):
        if "/issues?q=" in path:
            return [{"identifier": "GOL-154", "id": "umb-1"}]
        # /api/issues/{id}
        iid = path.rsplit("/", 1)[1]
        return self.store.get(iid)

    def post(self, path, body):
        self._n += 1
        iid = f"iss-{self._n}"
        rec = dict(body)
        rec["id"] = iid
        self.store[iid] = rec
        self.store["umb-1"]["children"].append({"id": iid})
        return {"id": iid}

    def patch(self, path, body):
        iid = path.rsplit("/", 1)[1]
        self.store[iid].update(body)
        return self.store[iid]


class TestApply(unittest.TestCase):
    def setUp(self):
        self.own = load_real_ownership()
        self.spec = load_spec("sample-spec.yml")
        self.emissions, _ = d.partition_spec(self.spec, self.own)
        self.r = resolver()

    def test_wave_gate_blockers(self):
        api = FakeApi()
        d.apply(api, "co-1", self.spec, self.emissions, self.r)
        by_key = {k: em for k, em in self.emissions.items()}
        wave1_ids = {em.issue_id for em in self.emissions.values() if em.wave == 1}
        hub = by_key["grove-sites/app-hub"]  # wave 2
        self.assertEqual(set(api.store[hub.issue_id]["blockedByIssueIds"]), wave1_ids)
        # wave-1 issues have no blockers
        for em in self.emissions.values():
            if em.wave == 1:
                self.assertEqual(api.store[em.issue_id]["blockedByIssueIds"], [])

    def test_apply_sets_assignee_parent_and_body(self):
        api = FakeApi()
        d.apply(api, "co-1", self.spec, self.emissions, self.r)
        hub = self.emissions["grove-sites/app-hub"]
        rec = api.store[hub.issue_id]
        self.assertEqual(rec["assigneeAgentId"], "0f58aac8-dbf7-4af7-bab7-944b067d01af")  # iris
        self.assertEqual(rec["parentId"], "umb-1")
        self.assertIn("decompose:", rec["description"])

    def test_idempotent_rerun_updates_no_duplicates(self):
        api = FakeApi()
        d.apply(api, "co-1", self.spec, self.emissions, self.r)
        first_ids = {em.issue_id for em in self.emissions.values()}
        n_after_first = len([k for k in api.store if k.startswith("iss-")])
        # fresh emissions from a re-partition (simulates a second tool run)
        emissions2, _ = d.partition_spec(self.spec, self.own)
        d.apply(api, "co-1", self.spec, emissions2, self.r)
        second_ids = {em.issue_id for em in emissions2.values()}
        n_after_second = len([k for k in api.store if k.startswith("iss-")])
        self.assertEqual(first_ids, second_ids, "re-run should reuse the same issue ids")
        self.assertEqual(n_after_first, n_after_second, "re-run must not create duplicates")
        self.assertTrue(all(em.action == "update" for em in emissions2.values()))


if __name__ == "__main__":
    unittest.main(verbosity=2)
