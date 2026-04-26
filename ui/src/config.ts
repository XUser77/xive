import { PublicKey } from "@solana/web3.js";

export const RPC_ENDPOINT = "https://xive.tima.kz:8899";

export const XIVE_PROGRAM_ID = new PublicKey(
  "xiveHxXiqHUkFnX5DsmTsAbByTZS5bdGGpdZ9wpmNCR",
);

export const PEG_KEEPER_PROGRAM_ID = new PublicKey(
  "xpeguefXy5MrgkbirCyuCCD5EfbUM5UfejdQduDcGz6",
);

export const VAULT_PROGRAM_ID = new PublicKey(
  "xva8xAjCCadQpphx5wCXnoLf5rkZuYu85Xxt88V3XnK",
);

export const LP_VAULT_MINT = new PublicKey(
  "xLPy37ThnjtANeeiqR9N2YmjK4q7T8zFNfQteFZ5PCm",
);

export const LP_VAULT_DECIMALS = 6;

export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

export const BPF_UPGRADEABLE_LOADER_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

export const XUSD_MINT = new PublicKey(
  "xusdSPQZr3PMbWNE4CcxVgezKL2UPcR74o45c6LWVF4",
);

export const XUSD_DECIMALS = 6;

export const USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);

export const USDC_DECIMALS = 6;

export const WHIRLPOOL_PROGRAM_ID = new PublicKey(
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
);

export const WHIRLPOOLS_CONFIG = new PublicKey(
  "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ",
);

export const STABLE_TICK_SPACING = 1;

// Must match programs/vault/src/constants.rs::LIQUIDATION_BONUS_BPS.
export const LIQUIDATION_BONUS_BPS = 500n;

export const KNOWN_MINTS: Record<string, { symbol: string; decimals: number }> = {
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs": { symbol: "WETH", decimals: 8 },
  "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh": { symbol: "WBTC", decimals: 8 },
  [USDC_MINT.toBase58()]: { symbol: "USDC", decimals: USDC_DECIMALS },
  [XUSD_MINT.toBase58()]: { symbol: "XUSD", decimals: XUSD_DECIMALS },
};
