import { PublicKey } from "@solana/web3.js";

export const RPC_ENDPOINT = "http://127.0.0.1:8899";

export const XIVE_PROGRAM_ID = new PublicKey(
  "xiveHxXiqHUkFnX5DsmTsAbByTZS5bdGGpdZ9wpmNCR",
);

export const PEG_KEEPER_PROGRAM_ID = new PublicKey(
  "xpeguefXy5MrgkbirCyuCCD5EfbUM5UfejdQduDcGz6",
);

export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

export const XUSD_MINT = new PublicKey(
  "xusdSPQZr3PMbWNE4CcxVgezKL2UPcR74o45c6LWVF4",
);

export const XUSD_DECIMALS = 6;

export const KNOWN_MINTS: Record<string, { symbol: string; decimals: number }> = {
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs": { symbol: "WETH", decimals: 8 },
  "5XZw2LKTyrfvfiskJ78AMpackRjPcyCif1WhUsPDuVqQ": { symbol: "WBTC", decimals: 8 },
  [XUSD_MINT.toBase58()]: { symbol: "XUSD", decimals: XUSD_DECIMALS },
};
