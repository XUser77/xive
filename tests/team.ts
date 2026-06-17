import { assert, expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  transferChecked,
  getAccount,
} from "@solana/spl-token";

import {
  teamProgram,
  connection,
  payer,
  XUSD_MINT,
  XIVE_TOKEN_MINT,
  VE_XIVE_TOKEN_MINT,
  XIVE_PROGRAM_ID,
  xivePda,
  teamPda,
  stakePda,
  ata,
  bn,
  giveXusd,
  newFundedKeypair,
  ataBalance,
  resetTeamCounters,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SystemProgram,
} from "./helpers.js";

const ONE = 1_000_000; // 6 decimals

async function giveXive(to: PublicKey, amount: number) {
  const dest = await getOrCreateAssociatedTokenAccount(connection, payer, XIVE_TOKEN_MINT, to, true);
  await transferChecked(
    connection,
    payer,
    ata(payer.publicKey, XIVE_TOKEN_MINT),
    XIVE_TOKEN_MINT,
    dest.address,
    payer,
    amount,
    6,
  );
}

async function deposit(staker: Keypair, amount: number) {
  await teamProgram.methods
    .deposit(bn(amount))
    .accountsPartial({
      signer: staker.publicKey,
      team: teamPda(),
      stake: stakePda(staker.publicKey),
      xiveMint: XIVE_TOKEN_MINT,
      veXiveMint: VE_XIVE_TOKEN_MINT,
      signerXiveAta: ata(staker.publicKey, XIVE_TOKEN_MINT),
      teamXiveAta: ata(teamPda(), XIVE_TOKEN_MINT),
      signerVeXiveAta: ata(staker.publicKey, VE_XIVE_TOKEN_MINT),
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .signers([staker])
    .rpc();
}

async function claim(staker: Keypair) {
  await teamProgram.methods
    .claim()
    .accountsPartial({
      signer: staker.publicKey,
      team: teamPda(),
      stake: stakePda(staker.publicKey),
      xusdMint: XUSD_MINT,
      teamAta: ata(teamPda(), XUSD_MINT),
      signerXusdAta: ata(staker.publicKey, XUSD_MINT),
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .signers([staker])
    .rpc();
}

describe("team: stake / distribute / claim / withdraw", () => {
  let s1: Keypair;
  let s2: Keypair;

  before(async function () {
    this.timeout(120000);
    // reset the persistent Team singleton so total_staked starts at 0 even when
    // surfpool isn't restarted between runs (prior runs leave stakers behind)
    await resetTeamCounters();
    // ensure the team has accrued fees to distribute (faucet borrowing already did this)
    await giveXusd(payer.publicKey, 1); // forces faucet setup if not yet done
    s1 = await newFundedKeypair();
    s2 = await newFundedKeypair();
    await giveXive(s1.publicKey, 100 * ONE);
    await giveXive(s2.publicKey, 300 * ONE);
  });

  it("deposit locks XIVE and mints frozen (non-transferable) veXIVE", async () => {
    await deposit(s1, 100 * ONE);

    const stake = await teamProgram.account.stake.fetch(stakePda(s1.publicKey));
    expect(stake.amount.toString()).to.eq(String(100 * ONE));

    // veXIVE minted 1:1 and frozen
    const ve = await getAccount(connection, ata(s1.publicKey, VE_XIVE_TOKEN_MINT));
    expect(ve.amount.toString()).to.eq(String(100 * ONE));
    expect(ve.isFrozen).to.eq(true);

    // XIVE moved into the team escrow
    assert.isTrue((await ataBalance(teamPda(), XIVE_TOKEN_MINT)) >= BigInt(100 * ONE));
  });

  it("distributes fees pro-rata and pays them out on claim", async () => {
    await deposit(s2, 300 * ONE); // total staked now 400

    const team = await teamProgram.account.team.fetch(teamPda());
    const totalStaked = BigInt(team.totalStaked.toString());
    expect(totalStaked).to.eq(BigInt(400 * ONE));

    // distribute 400 xUSD of fees -> 1.0 xUSD per staked veXIVE
    const dist = 400 * ONE;
    await teamProgram.methods
      .transferFromXive(bn(dist))
      .accountsPartial({
        authority: payer.publicKey,
        team: teamPda(),
        xive: xivePda(),
        xusdMint: XUSD_MINT,
        teamAta: ata(teamPda(), XUSD_MINT),
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        xiveProgram: XIVE_PROGRAM_ID,
      })
      .rpc();

    // s1 has 100/400 = 25% -> 100 xUSD; s2 has 300/400 = 75% -> 300 xUSD
    const s1Before = await ataBalance(s1.publicKey, XUSD_MINT);
    await claim(s1);
    expect((await ataBalance(s1.publicKey, XUSD_MINT)) - s1Before).to.eq(BigInt(100 * ONE));

    const s2Before = await ataBalance(s2.publicKey, XUSD_MINT);
    await claim(s2);
    expect((await ataBalance(s2.publicKey, XUSD_MINT)) - s2Before).to.eq(BigInt(300 * ONE));
  });

  it("a second claim with no new fees pays nothing", async () => {
    try {
      await claim(s1);
      assert.fail("expected NothingToClaim");
    } catch (e: any) {
      const blob = [
        e?.toString?.() ?? "",
        e?.message ?? "",
        typeof e?.error === "object" ? JSON.stringify(e.error) : "",
        Array.isArray(e?.logs) ? e.logs.join("\n") : "",
      ].join("\n");
      expect(blob).to.contain("NothingToClaim");
    }
  });

  it("withdraw burns veXIVE and returns XIVE; late fees only go to remaining stakers", async () => {
    // s1 exits entirely
    const xive0 = await ataBalance(s1.publicKey, XIVE_TOKEN_MINT);
    await teamProgram.methods
      .withdraw(bn(100 * ONE))
      .accountsPartial({
        signer: s1.publicKey,
        team: teamPda(),
        stake: stakePda(s1.publicKey),
        xiveMint: XIVE_TOKEN_MINT,
        veXiveMint: VE_XIVE_TOKEN_MINT,
        signerXiveAta: ata(s1.publicKey, XIVE_TOKEN_MINT),
        teamXiveAta: ata(teamPda(), XIVE_TOKEN_MINT),
        signerVeXiveAta: ata(s1.publicKey, VE_XIVE_TOKEN_MINT),
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([s1])
      .rpc();

    expect((await ataBalance(s1.publicKey, XIVE_TOKEN_MINT)) - xive0).to.eq(BigInt(100 * ONE));
    expect(await ataBalance(s1.publicKey, VE_XIVE_TOKEN_MINT)).to.eq(0n);

    const s1Stake = await teamProgram.account.stake.fetch(stakePda(s1.publicKey));
    expect(s1Stake.amount.toString()).to.eq("0");

    // distribute 300 more -> now only s2 (300 staked) earns; s1 gets nothing
    await teamProgram.methods
      .transferFromXive(bn(300 * ONE))
      .accountsPartial({
        authority: payer.publicKey,
        team: teamPda(),
        xive: xivePda(),
        xusdMint: XUSD_MINT,
        teamAta: ata(teamPda(), XUSD_MINT),
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        xiveProgram: XIVE_PROGRAM_ID,
      })
      .rpc();

    const s2Before = await ataBalance(s2.publicKey, XUSD_MINT);
    await claim(s2);
    expect((await ataBalance(s2.publicKey, XUSD_MINT)) - s2Before).to.eq(BigInt(300 * ONE));
  });
});
