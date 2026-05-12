#!/bin/bash

# --slot-time 1000: stretches each slot to 1s, giving a 150-second blockhash
# window (150 slots × 1s). Necessary when the dev box reaches surfpool over
# a high-latency link (e.g. SSH tunnel ~150ms RTT) — `solana program deploy`
# of large programs (xive) would otherwise age its blockhashes out mid-write.
surfpool start --network mainnet --no-deploy --slot-time 1000