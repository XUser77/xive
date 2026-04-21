import { PublicKey } from "@solana/web3.js";

export const RPC_ENDPOINT = "http://127.0.0.1:8899";

export const XIVE_PROGRAM_ID = new PublicKey(
  "xiveHxXiqHUkFnX5DsmTsAbByTZS5bdGGpdZ9wpmNCR",
);

export const KNOWN_MINTS: Record<string, { symbol: string; decimals: number }> = {
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs": { symbol: "WETH", decimals: 8 },
  "5XZw2LKTyrfvfiskJ78AMpackRjPcyCif1WhUsPDuVqQ": { symbol: "WBTC", decimals: 8 },
  xusdSPQZr3PMbWNE4CcxVgezKL2UPcR74o45c6LWVF4: { symbol: "XUSD", decimals: 6 },
};
