#!/usr/bin/env bash
# CI gate for the vendor-status guard's test suite (GOL-3021).
#
# ci.yml auto-discovers scripts/ci/*.test.sh, so this thin delegate is what
# puts infra/scripts/vendor-status-guard.test.sh on the required-check path.
# The suite itself lives next to the script it tests, for two reasons:
#   - it is runnable by hand on the Droplet, where scripts/ci/ is irrelevant;
#   - scripts/ci/** is a Tier-0 protected glob (protected-paths-carveout.mjs),
#     so keeping the 39 test cases out of it lets the guard and its tests ship
#     without a protected-path review, and leaves only this 1-line delegate
#     needing one.
# Hermetic: no network, no webhook, temp state. See the suite's header.
set -euo pipefail
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/infra/scripts/vendor-status-guard.test.sh"
