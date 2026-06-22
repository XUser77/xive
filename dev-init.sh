#!/usr/bin/env bash
#
# Initialize the Xive programs on a LOCAL surfpool/validator (http://localhost:8899).
#
# Thin wrapper around deploy-initialize.sh — same logic, local RPC. Runs the
# one-shot `initialize` instructions for xive / vault / team (idempotent: skips
# anything already initialized).
#
# Prerequisites: a local node is running on :8899 and the programs are deployed
# (e.g. `yarn surfpool` then `anchor deploy`, or `./deploy-programs.sh` with
# RPC_URL=http://localhost:8899).
#
# Env overrides are passed straight through (WALLET, LOAN_FEE, FUND_SOL, RPC_URL).

set -euo pipefail
cd "$(dirname "$0")"

exec env RPC_URL="${RPC_URL:-http://localhost:8899}" ./deploy-initialize.sh "$@"
