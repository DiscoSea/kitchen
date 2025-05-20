/**
 * @file instructionBuilder.js
 * @description Module for handling instruction building operations.
 */

import {
  PublicKey,
  TransactionInstruction,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { createHash } from "crypto";
import { Buffer } from "buffer";

import {
  PROGRAM_ID,
  METADATA_PROGRAM_ID,
  FEE_ACCOUNT_PUBKEY,
  CONFIG_ACCOUNT,
  IPFS_GATEWAY,
} from "./constants.js";

// ─── Helpers ─────────────────────────────────────────────────────────
function encodeU32(value) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value, 0);
  return buf;
}

function encodeU64(value) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value), 0);
  return buf;
}

function encodeString(str) {
  const strBuffer = Buffer.from(str, "utf-8");
  const lenBuffer = encodeU32(strBuffer.length);
  return Buffer.concat([lenBuffer, strBuffer]);
}

function sortSeeds(seeds) {
  return [...seeds].sort((a, b) =>
    new PublicKey(a.mint).toBuffer().compare(new PublicKey(b.mint).toBuffer())
  );
}

// ─── PDA Logic ──────────────────────────────────────────────────────
export function derivePDAFromCookedData(cookedData) {
  const sortedSeeds = sortSeeds(cookedData.seeds);

  const seedChunks = sortedSeeds.flatMap((seed) => {
    const mintBytes = new PublicKey(seed.mint).toBuffer();
    const qtyBytes = encodeU64(seed.amount_u64);
    return [mintBytes, qtyBytes];
  });

  const saltBytes = Buffer.alloc(32);
  Buffer.from(cookedData.salt, "utf8").copy(saltBytes);

  const concatenated = Buffer.concat([...seedChunks, saltBytes]);
  const sha256Hash = createHash("sha256").update(concatenated).digest();
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [sha256Hash],
    PROGRAM_ID
  );

  console.log("Generated PDA:", pda.toBase58());
  return { pda, bump, sha256Hash };
}

export function findCookPDA(concatenatedData, salt) {
  const saltBytes = new Uint8Array(32);
  const encodedSalt = new TextEncoder().encode(salt);
  saltBytes.set(encodedSalt.subarray(0, 32));

  const combined = new Uint8Array(concatenatedData.length + 32);
  combined.set(concatenatedData);
  combined.set(saltBytes, concatenatedData.length);

  const sha256Hash = new Uint8Array(
    createHash("sha256").update(combined).digest()
  );
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [sha256Hash],
    PROGRAM_ID
  );

  console.log("SHA256 Hash:", Buffer.from(sha256Hash).toString("hex"));
  console.log("Derived PDA:", pda.toBase58());
  console.log("Bump Seed:", bump);

  return { pda, bump, sha256Hash };
}

// ─── Validation ─────────────────────────────────────────────────────
export function validateCookedData(cookedData) {
  if (!cookedData || typeof cookedData !== "object") {
    throw new Error("Invalid cookedData: Input must be an object.");
  }

  const requiredFields = ["seeds", "metadataCid", "name", "symbol"];
  for (const field of requiredFields) {
    if (!cookedData[field]) {
      throw new Error(`Invalid cookedData: Missing required field '${field}'.`);
    }
  }
  if (!("salt" in cookedData))
    throw new Error("Invalid cookedData: Missing required field 'salt'.");
  if (!Array.isArray(cookedData.seeds))
    throw new Error("Invalid cookedData: 'seeds' must be an array.");
  if (!cookedData.seeds.every((s) => s.mint && s.amount_u64 !== undefined)) {
    throw new Error(
      "Invalid cookedData: Each seed must have 'mint' and 'amount_u64'."
    );
  }

  cookedData.seeds = sortSeeds(cookedData.seeds);
  cookedData.pda = derivePDAFromCookedData(cookedData).pda.toBase58();

  return cookedData;
}

function validateCookedDataForCooking(cookedData) {
  if (!cookedData || typeof cookedData !== "object") {
    throw new Error("Invalid cookedData: Input must be an object.");
  }
  const requiredFields = ["pda", "seeds"];
  for (const field of requiredFields) {
    if (!cookedData[field]) {
      throw new Error(`Invalid cookedData: Missing required field '${field}'.`);
    }
  }
  if (!("seedSalt" in cookedData))
    throw new Error("Invalid cookedData: Missing required field 'seedSalt'.");
  if (!Array.isArray(cookedData.seeds))
    throw new Error("Invalid cookedData: 'seeds' must be an array.");
  if (!cookedData.seeds.every((s) => s.mint && s.amount_u64 !== undefined)) {
    throw new Error(
      "Invalid cookedData: Each seed must have 'mint' and 'amount_u64'."
    );
  }

  console.log("cooked Data is Valid");
  cookedData.seeds = sortSeeds(cookedData.seeds);
  cookedData.pda = derivePDAFromCookedData(cookedData).pda.toBase58();
  return cookedData;
}

// ─── Instructions ───────────────────────────────────────────────────
export async function createRecipe(feePayerPubkey, cookedData) {
  console.log("Calling createRecipe");
  const { pda, seeds, salt, metadataCid, name, symbol } =
    validateCookedData(cookedData);
  const uri = `${IPFS_GATEWAY}${metadataCid}`;

  const instructionData = Buffer.concat([
    Buffer.from([0x01]),
    encodeU32(seeds.length),
    Buffer.concat(seeds.map((s) => encodeU64(s.amount_u64))),
    Buffer.concat([Buffer.alloc(32, 0), Buffer.from(salt).slice(0, 32)]),
    encodeString(name),
    encodeString(symbol),
    encodeString(uri),
  ]);

  const pdaPubkey = new PublicKey(pda);
  const [metadataPda] = await PublicKey.findProgramAddress(
    [
      Buffer.from("metadata"),
      METADATA_PROGRAM_ID.toBuffer(),
      pdaPubkey.toBuffer(),
    ],
    METADATA_PROGRAM_ID
  );

  const keys = [
    { pubkey: feePayerPubkey, isSigner: true, isWritable: true },
    { pubkey: FEE_ACCOUNT_PUBKEY, isSigner: false, isWritable: true },
    { pubkey: CONFIG_ACCOUNT, isSigner: false, isWritable: false },
    { pubkey: pdaPubkey, isSigner: false, isWritable: true },
    { pubkey: metadataPda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
    ...seeds.map((s) => ({
      pubkey: new PublicKey(s.mint),
      isSigner: false,
      isWritable: false,
    })),
  ];

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data: instructionData,
  });
}

function toBaseUnits(amountStr, decimals) {
  const floatVal = parseFloat(amountStr);
  if (isNaN(floatVal)) throw new Error("Invalid number in qty_requested");
  return BigInt(Math.floor(floatVal * 10 ** decimals));
}

export async function useRecipe(
  feePayerPubkey,
  cookedData,
  tokenAccounts,
  option
) {
  if (![0x02, 0x03].includes(option))
    throw new Error("❌ Invalid option. Must be 0x02 (cook) or 0x03 (uncook).");
  console.log("Calling cookRecipe");

  const { pda, seeds, seedSalt } = validateCookedDataForCooking(cookedData);
  if (tokenAccounts.length !== 2 * seeds.length + 2) {
    console.log("❌ Not enough token accounts.");
    console.log(
      "👉 To fix: pass all PDA token accounts and user token accounts for each mint."
    );
    return null;
  }

  const pdaPubkey = new PublicKey(pda);
  const instructionData = Buffer.concat([
    Buffer.from([option]),
    encodeU32(seeds.length),
    Buffer.concat(seeds.map((s) => encodeU64(s.amount_u64))),
    Buffer.concat([Buffer.alloc(32, 0), Buffer.from(seedSalt).slice(0, 32)]),
    encodeU64(toBaseUnits(cookedData.qty_requested, 6)),
  ]);

  const keys = [
    { pubkey: feePayerPubkey, isSigner: true, isWritable: true },
    { pubkey: FEE_ACCOUNT_PUBKEY, isSigner: false, isWritable: true },
    { pubkey: CONFIG_ACCOUNT, isSigner: false, isWritable: false },
    { pubkey: pdaPubkey, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ...seeds.map((s) => ({
      pubkey: new PublicKey(s.mint),
      isSigner: false,
      isWritable: false,
    })),
    ...tokenAccounts.map((ta) => ({
      pubkey: new PublicKey(ta),
      isSigner: false,
      isWritable: true,
    })),
  ];

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data: instructionData,
  });
}
