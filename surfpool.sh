#!/usr/bin/env bash
# Fork mainnet with Surfpool, using the RPC endpoint from .env (RPC_URL=...).
#
# Usage:  ./surfpool.sh           (then in another shell: anchor deploy && npx mocha)
# --slot-time 200: faster slots speed up deploys (--use-rpc) and tests; --use-rpc
# auto-refreshes the blockhash if it expires, so we don't need the old slow 1000ms.
#
# NOTE: on a live fork, fund wallets at runtime via the surfnet_setAccount cheat RPC
# (genesis --airdrop is shadowed by the remote datasource), e.g.:
#   curl -s http://127.0.0.1:8899 -X POST -H 'content-type: application/json' \
#     -d '{"jsonrpc":"2.0","id":1,"method":"surfnet_setAccount","params":["<PUBKEY>",{"lamports":1000000000000}]}'
set -euo pipefail
cd "$(dirname "$0")"

# load .env (auto-export every assignment)
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

if [ -z "${RPC_URL:-}" ]; then
  echo "RPC_URL is not set. Add it to .env, e.g.:  RPC_URL=https://solana-mainnet.g.alchemy.com/v2/<key>" >&2
  exit 1
fi

# Fund the Anchor deploy/provider wallet once the RPC is up. Genesis --airdrop is
# shadowed by the remote datasource on a live fork, so we set a current-slot override
# via surfnet_setAccount instead. Runs in the background and exits after funding.
RPC_LOCAL="http://127.0.0.1:8899"
(
  for _ in $(seq 1 90); do
    if curl -s -m 2 "$RPC_LOCAL" -X POST -H 'content-type: application/json' \
         -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | grep -q '"result"'; then
      for w in keys/test-wallet.json keys/deploy-wallet.json; do
        pk=$(solana-keygen pubkey "$w")
        curl -s "$RPC_LOCAL" -X POST -H 'content-type: application/json' \
          -d '{"jsonrpc":"2.0","id":1,"method":"surfnet_setAccount","params":["'"$pk"'",{"lamports":1000000000000}]}' >/dev/null
        echo ">> funded $pk with 1000 SOL"
      done
      break
    fi
    sleep 1
  done
) &

surfpool start \
  --legacy-anchor-compatibility \
  --watch \
  --no-tui \
  --log-level debug \
  --slot-time 200 \
  --rpc-url "$RPC_URL" \
  "$@"
