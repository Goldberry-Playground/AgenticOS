#!/usr/bin/env node
// maintainer-approve-gate.mjs — the decision for auto-approve.yml's
// human-maintainer path (GOL-1938, extended by GOL-3225).
//
// Why this exists: a trusted maintainer (Josh) cannot approve his own PR, and
// he is the only human maintainer. For a PR that touches NO protected path the
// bot simply clears the review gate (GOL-1207 parity). For a PR that DOES touch
// one, the GOL-1406-A carve-out used to withhold unconditionally and tell the
// PR it "needs a human maintainer's review" — but the only human maintainer is
// the author, so nobody could ever approve it (AgenticOS#867, 2026-10-07: the
// revert of #863 had to be re-authored as the App mid-incident, GOL-3216).
//
// The rule now (same as GOL-2372 in the Grove repos: "agent-review/ada =
// maintainer PR approval"): a protected-path maintainer PR is approved by
// github-actions[bot] ONLY once an `agent-review/*` check-run is `success` on
// the CURRENT head SHA. Protected paths still get a real review — Ada's — it
// is just no longer required to come from a second human. Auto-merge stays
// off for maintainer PRs either way; the maintainer decides when to merge.
//
// Contract (CLI):
//   env PR_FILES           = newline-separated changed paths.
//   env AGENT_REVIEW_STATE = agent-review/* state on the current head SHA, as
//                            computed by auto-approve.yml: success | pending |
//                            absent | completed-not-success. Only consulted
//                            when a protected path is touched. Unset/unknown is
//                            treated as NOT success (fail-closed).
//   exit 0 -> approve; reason on stdout.
//   exit 1 -> withhold; reason on stdout. A missing file / throw also lands
//             here via the workflow's `if !` — fail-closed.
import { pathToFileURL } from "node:url";
import { protectedHits } from "./protected-paths-carveout.mjs";

export function decide({ files, reviewState }) {
  const hits = protectedHits(files);
  if (hits.length === 0) {
    return {
      approve: true,
      protected: false,
      reason: "no protected path touched — maintainer review gate cleared",
    };
  }
  if (reviewState === "success") {
    return {
      approve: true,
      protected: true,
      reason:
        "protected path(s) touched (" + hits.join(", ") + ") and agent-review/* is success on the current head — " +
        "Ada's review stands in for the second human (GOL-3225)",
    };
  }
  return {
    approve: false,
    protected: true,
    reason:
      "protected path(s) touched (" + hits.join(", ") + ") — waiting on agent-review/ada " +
      "(state on the current head: " + (reviewState || "unknown") + "). github-actions[bot] approves " +
      "automatically once it is success on this head SHA (GOL-3225).",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const d = decide({
    files: (process.env.PR_FILES || "").split("\n"),
    reviewState: process.env.AGENT_REVIEW_STATE || "",
  });
  process.stdout.write(d.reason);
  process.exit(d.approve ? 0 : 1);
}
