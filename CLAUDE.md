# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Xive is an overcollateralized stablecoin (CDP) protocol on Solana that mints **xUSD** against deposited collateral. This is an Anchor workspace with two programs whose source lives here: **`programs/xive`** (the core lending program) and **`programs/vault`** (the xUSD/USDC LP vault — early WIP, only `initialize` exists so far). `Anchor.toml` declares four more sibling programs — `team`, `fees`, `collaterals`, `peg_keeper` — whose IDs and keypairs exist (`keys/*-program.json`) but whose source lives outside this repo. The `vault` and `team` program addresses appear inside `xive` as the privileged signers `VAULT_ADDRESS` / `TEAM_ADDRESS`.

Key fixed addresses (`programs/xive/src/constants.rs`, `programs/vault/src/constants.rs`, `Anchor.toml`):
- xive program: `xiveHxXiqHUkFnX5DsmTsAbByTZS5bdGGpdZ9wpmNCR`
- xUSD mint: `xusdSPQZr3PMbWNE4CcxVgezKL2UPcR74o45c6LWVF4` — 6 decimals, mint/freeze authority = the `xive` PDA
- vault program: `xva8xAjCCadQpphx5wCXnoLf5rkZuYu85Xxt88V3XnK` (also the `VAULT_ADDRESS` signer); team signer: `xtm3…fwD4i`
- LP-xUSD mint: `xLPy37ThnjtANeeiqR9N2YmjK4q7T8zFNfQteFZ5PCm` — 6 decimals, mint/freeze authority = the `vault` PDA

## Commands

Root package manager is **yarn**; the **`ui/`** subproject uses **npm**.

Program (Rust / Anchor):
- `anchor build` — compile the SBF program and regenerate the IDL.
- `cargo check -p xive` / `cargo check -p vault` (and `cargo clippy -p <prog>`) — fast validation on the host target, much faster than a full build (misses only `cfg(target_os = "solana")`-gated issues). Rust is pinned to 1.89.0 (`rust-toolchain.toml`).
- `cargo fmt`.
- The release profile sets `overflow-checks = true` (`Cargo.toml`), so arithmetic overflow panics on-chain — the explicit `checked_*` math is a typed-error layer on top of that backstop.

Tests (TypeScript / Mocha) — note `tests/` is currently **empty**; the harness is wired but no tests exist yet:
- `anchor test` runs the `Anchor.toml` `[scripts].test`: `ts-mocha -p ./tsconfig.json -t 1000000 "tests/**/*.ts"`.
- Single file / test: `yarn ts-mocha -p ./tsconfig.json -t 1000000 tests/<file>.ts` (add `-g "<pattern>"` to filter by name).
- `.mocharc.cjs` points the provider at `http://127.0.0.1:8899` with wallet `keys/test-wallet.json`, and requires a global `tests/hooks.ts`.
- Lint TS/JS: `yarn lint` (prettier check) / `yarn lint:fix`.

Local validator — this project runs against a **mainnet fork** (Surfpool), not a bare `solana-test-validator`, because collateral pricing reads live mainnet state (Orca Whirlpools, real mints):
- `./surfnet.sh` (forks mainnet, `--slot-time 1000` to survive high-latency deploys) or `yarn surfpool` (forks via an Alchemy mainnet RPC, `--legacy-anchor-compatibility`). Both start `--no-deploy`; deploy separately with `anchor deploy` (wallet `keys/test-wallet.json`, program keypairs in `keys/`).

UI:
- `cd ui && npm install && npm run dev` (Vite dev server); `npm run build` to type-check + bundle. Uses `@coral-xyz/anchor` 0.29, `@orca-so/whirlpools-sdk`, and wallet-adapter against the IDL at `ui/src/idl/xive.json`.

## Architecture of `programs/xive`

A borrower locks collateral in a **Position** and mints xUSD up to the collateral's `ltv`; positions at/above `liquidation_ltv` can be liquidated. `lib.rs` is a thin dispatcher — each instruction module owns its `#[derive(Accounts)]` context plus a handler, and the token-moving logic is centralized.

**State accounts** (`src/state/`, all PDAs):
- `Xive` singleton (`["xive"]`) — global config: `loan_fee` (bps) and `vault_balance` / `team_balance` (`i64`). It is the xUSD mint authority and signs every CPI via the `["xive"]` seed.
- `Wallet` (`["wallet", borrower]`) — per-borrower monotonic position counter (`index`).
- `Collateral` (`["collateral", mint]`) — per-collateral config: `enabled`, `ltv`, `liquidation_ltv` (bps), plus a manually-pushed `price` + `price_date`.
- `Position` (`["pos", borrower, index]`) — `collateral_mint`, `collateral_amount`, `loan_amount`, `close_date` (0 = open).

**Shared-helper pattern (read this first).** `src/instructions/process_position.rs` holds the real logic — `deposit_collateral`, `withdraw_collateral`, `borrow_xusd`, `return_xusd`. The user-facing instructions are thin wrappers that delegate here: `deposit` / `withdraw` / `borrow` / `repay` each call one helper, and `open_position` composes `deposit_collateral` + `borrow_xusd`. To understand any position mutation, read both the instruction's Accounts struct **and** the helper it calls.

**Collateral custody.** There is **one program-owned ATA per collateral mint** (authority = `xive` PDA, created in `update_collateral`), shared across all positions of that mint. `position.collateral_amount` is a per-position *claim* on that shared pool. The invariant the code must preserve: pool token balance ≥ Σ(active positions' `collateral_amount`).

**Fees & vault/team balances.** `borrow_xusd` charges an origination fee (`loan_fee` bps), splits it 20% vault / 80% team, and accrues it into `Xive.vault_balance` / `team_balance`. These are `i64` net positions that are **intentionally allowed to go negative**: the `vault` can mint xUSD directly (negative = borrowing) and repay in batches. The `mint` / `burn` instructions (callable only by `VAULT_ADDRESS` / `TEAM_ADDRESS`) move xUSD in/out and adjust these balances (mint decreases, burn increases); `team` is capped at its balance, `vault` is not.

**Liquidation spans three instructions.** `liquidate_position` (vault-only) zeroes the position's debt and collateral and shifts the debt onto `vault_balance`; the vault later returns any surplus collateral via `return_collateral`; the borrower reclaims it through `withdraw`. `withdraw` deliberately does **not** check `close_date`, so a closed/liquidated position stays withdrawable for this return path — keep that intentional when editing it.

**Pricing.** Collateral prices are pushed on-chain via `set_collateral_price` and treated as stale after `PRICE_TIMEOUT` (300s); `borrow_xusd` / `withdraw_collateral` / `liquidate_position` reject stale prices. Off-chain, prices come from Orca Whirlpools (`ui/src/orca.ts`); `peg_keeper` is the intended on-chain price/peg maintainer.

**Money-math conventions.** All arithmetic uses `checked_*` mapped to `XiveError::MathOverflow`; ratios/fees are basis points (`/ 10_000`); `utils.rs` does percentage math in `u128` to avoid intermediate overflow; `u64 → i64` balance conversions use checked `i64::try_from(...)` — never `as i64`, which silently wraps large values negative.

## Architecture of `programs/vault`

Early WIP, same structural conventions as `xive` (thin `lib.rs` dispatcher → per-instruction module owning its `#[derive(Accounts)]` + handler; PDA bumps persisted at init). Intended as an xUSD/USDC liquidity vault that mints an **LP-xUSD** share token (`xLPy…`) against pooled assets, with a `SWAP_FEE` of 5 bps (0.05%).

- `Vault` singleton (`["vault"]`, `src/state/vault.rs`) — `bump`, plus `xusd_assets` / `usdc_assets` (`u64`) reserve accounting. It is the LP-xUSD mint authority and signs CPIs via the `["vault"]` seed (hence the stored `bump`).
- Constants (`src/constants.rs`): `VAULT_SEED`, `SWAP_FEE` (bps), `LP_XUSD_ADDRESS`, `LP_XUSD_DECIMALS` (6).
- Only instruction so far: `initialize` — creates the `Vault` PDA and the fixed LP-xUSD mint (authority/freeze = vault PDA). It's one-shot (a second call fails on `init`) and currently has **no admin gate**, like `xive::initialize`. `deposit` / `withdraw` / swap logic against `xusd_assets` / `usdc_assets` are not written yet.

## Gotchas

- **Anchor version skew:** the on-chain program is Anchor **1.0.2**, but the TS clients pin `@coral-xyz/anchor` **0.29** — hence `--legacy-anchor-compatibility` for surfpool.
- The `mint` / `burn` instruction Accounts structs are named `Mint` / `Burn`, shadowing `anchor_spl::token::{Mint, Burn}`; the SPL types are referenced qualified as `token::Mint` / `token::Burn`.
- **Work in progress:** some token transfers are stubbed `// TODO` (collateral seizure in `liquidate_position`, the transfer in `return_collateral` — only the accounting half runs today), and `update_collateral` / `set_collateral_price` have no authority check yet (the `Xive` account stores no admin key). Verify these before relying on them.
