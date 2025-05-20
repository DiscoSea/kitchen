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

// Manual Borsh serialization helpers
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

/**
 * Validates cookedData and enriches it with the derived PDA.
 *
 * @param {object} cookedData
 * @returns {object} enriched cookedData with .pda set
 */
export function validateCookedData(cookedData) {
  if (!cookedData || typeof cookedData !== "object") {
    throw new Error("Invalid cookedData: Input must be an object.");
  }

  console.log("debuglog from @discosea/kitchen:validateCookedData", cookedData);

  const requiredFields = ["seeds", "metadataCid", "name", "symbol"];
  for (const field of requiredFields) {
    if (!cookedData[field]) {
      throw new Error(`Invalid cookedData: Missing required field '${field}'.`);
    }
  }

  if (!("salt" in cookedData)) {
    throw new Error("Invalid cookedData: Missing required field 'salt'.");
  }

  if (!Array.isArray(cookedData.seeds)) {
    throw new Error("Invalid cookedData: 'seeds' must be an array.");
  }

  if (!cookedData.seeds.every((s) => s.mint && s.amount_u64 !== undefined)) {
    throw new Error(
      "Invalid cookedData: Each seed must have 'mint' and 'amount_u64'."
    );
  }

  // Sort seeds for consistency before PDA derivation
  cookedData.seeds.sort((a, b) =>
    new PublicKey(a.mint).toBuffer().compare(new PublicKey(b.mint).toBuffer())
  );

  const { pda } = derivePDAFromCookedData(cookedData);
  cookedData.pda = pda.toBase58();

  return cookedData;
}

/**
 * Finds the Cook PDA (Program Derived Address) based on concatenated data and a salt.
 *
 * @param {Buffer | Uint8Array} concatenatedData - The input data to derive the PDA.
 * @param {string} salt - A unique salt used for PDA derivation.
 * @returns {{ pda: PublicKey, bump: number, sha256Hash: Uint8Array }}
 * An object containing the derived PDA, bump seed, and SHA-256 hash.
 */
export function findCookPDA(concatenatedData, salt) {
  // Convert salt to a fixed 32-byte Uint8Array with padding
  const saltBytes = new Uint8Array(32);
  const encodedSalt = new TextEncoder().encode(salt);
  saltBytes.set(encodedSalt.subarray(0, Math.min(encodedSalt.length, 32)));

  // Concatenate the single Uint8Array with saltBytes
  const totalLength = concatenatedData.length + 32;
  const concatenated = new Uint8Array(totalLength);
  concatenated.set(concatenatedData, 0);
  concatenated.set(saltBytes, concatenatedData.length);

  // Compute SHA-256 hash
  const sha256Hash = new Uint8Array(
    createHash("sha256").update(concatenated).digest()
  );

  // Derive PDA
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [sha256Hash],
    PROGRAM_ID
  );

  console.log(`SHA256 Hash: ${Buffer.from(sha256Hash).toString("hex")}`);
  console.log(`Derived PDA: ${pda.toBase58()}`);
  console.log(`Bump Seed: ${bump}`);

  return { pda, bump, sha256Hash };
}

/**
 * Derives PDA from cookedData's seeds and salt.
 * Always sorts seeds internally to match on-chain hash behavior.
 *
 * @param {Object} cookedData - Must include { seeds, salt }
 * @returns {{ pda: PublicKey, bump: number, sha256Hash: Buffer }}
 */
export function derivePDAFromCookedData(cookedData) {
  if (!Array.isArray(cookedData.seeds)) {
    throw new Error("cookedData.seeds must be an array");
  }
  if (typeof cookedData.salt !== "string") {
    throw new Error("cookedData.salt must be a string");
  }

  // Sort for safety
  const sortedSeeds = [...cookedData.seeds].sort((a, b) =>
    new PublicKey(a.mint).toBuffer().compare(new PublicKey(b.mint).toBuffer())
  );

  const seedChunks = [];

  for (const seed of sortedSeeds) {
    const mintBytes = new PublicKey(seed.mint).toBuffer();

    const qtyBytes = Buffer.alloc(8);
    qtyBytes.writeBigUInt64LE(BigInt(seed.amount_u64));

    seedChunks.push(mintBytes, qtyBytes);
  }

  const saltBytes = Buffer.alloc(32);
  const saltUtf8 = Buffer.from(cookedData.salt, "utf8");
  saltUtf8.copy(saltBytes, 0, 0, Math.min(32, saltUtf8.length));

  const concatenated = Buffer.concat([...seedChunks, saltBytes]);
  const sha256Hash = createHash("sha256").update(concatenated).digest();

  const [pda, bump] = PublicKey.findProgramAddressSync(
    [sha256Hash],
    PROGRAM_ID
  );

  console.log("Generated PDA:" + pda.toBase58());

  return { pda, bump, sha256Hash };
}

/**
 * Creates a transaction instruction for the "createRecipe" process, constructing
 * a PDA (Program Derived Address) and associated metadata for an on-chain recipe.
 *
 * @param {PublicKey} feePayerPubkey - The public key of the fee payer executing the transaction.
 * @param {Object} cookedData - The cooked recipe data containing necessary fields for creation.
 * @param {string} cookedData.pda - The derived PDA for the recipe.
 * @param {Array<Object>} cookedData.seeds - An array of seeds required for PDA derivation.
 * @param {string} cookedData.salt - A unique salt value to ensure uniqueness.
 * @param {string} cookedData.metadataCid - The IPFS CID storing metadata.
 * @param {string} cookedData.name - The name of the recipe.
 * @param {string} cookedData.symbol - The symbol associated with the recipe.
 *
 * @returns {Promise<TransactionInstruction>} A promise resolving to a Solana `TransactionInstruction`
 * that can be included in a transaction for execution on-chain.
 */
export async function createRecipe(feePayerPubkey, cookedData) {
  console.log("Calling createRecipe");

  // Validate and destructure fields directly
  const { pda, seeds, salt, metadataCid, name, symbol } =
    validateCookedData(cookedData);
  const uri = `${IPFS_GATEWAY}${metadataCid}`;

  let instructionData = Buffer.alloc(1);
  instructionData.writeUInt8(0x01, 0);

  const pdaPubkey = new PublicKey(pda);
  const metadataPda = await PublicKey.findProgramAddress(
    [
      Buffer.from("metadata"),
      METADATA_PROGRAM_ID.toBuffer(),
      pdaPubkey.toBuffer(),
    ],
    METADATA_PROGRAM_ID
  );

  let accounts = [
    { pubkey: feePayerPubkey, isSigner: true, isWritable: true }, // payer_account
    { pubkey: FEE_ACCOUNT_PUBKEY, isSigner: false, isWritable: true }, // fee_account
    { pubkey: CONFIG_ACCOUNT, isSigner: false, isWritable: false }, // config_account
    { pubkey: pdaPubkey, isSigner: false, isWritable: true }, // pda_account
    { pubkey: metadataPda[0], isSigner: false, isWritable: true }, // metadata_account
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }, // rent_sysvar
    { pubkey: METADATA_PROGRAM_ID, isSigner: false, isWritable: false }, // metadata_program
  ];

  for (const seed of seeds) {
    if (seed.mint) {
      accounts.push({
        pubkey: new PublicKey(seed.mint),
        isSigner: false,
        isWritable: false,
      });
    }
  }

  // Handling amounts
  const amounts = seeds.map((s) => BigInt(s.amount_u64));
  const amountsLen = encodeU32(amounts.length);
  const amountsData = Buffer.concat(amounts.map(encodeU64));

  instructionData = Buffer.concat([instructionData, amountsLen, amountsData]);

  // Handling salt
  let saltBuffer = Buffer.alloc(32);
  const saltBytes = Buffer.from(salt, "utf-8");
  saltBytes.copy(saltBuffer, 0, 0, Math.min(saltBytes.length, 32));

  instructionData = Buffer.concat([instructionData, saltBuffer]);

  // Handling encoded strings
  const nameData = encodeString(name);
  const symbolData = encodeString(symbol);
  const uriData = encodeString(uri);

  instructionData = Buffer.concat([
    instructionData,
    nameData,
    symbolData,
    uriData,
  ]);

  console.log("Instruction Data Breakdown:");
  console.log("  Instruction ID:", instructionData.slice(0, 1).toString("hex"));
  console.log("  Amounts Length:", amountsLen.toString("hex"));
  console.log("  Amounts Data:", amountsData.toString("hex"));
  console.log("  Salt:", saltBuffer.toString("hex"));
  console.log("  Name:", nameData.toString("hex"));
  console.log("  Symbol:", symbolData.toString("hex"));
  console.log("  URI:", uriData.toString("hex"));
  console.log("Final instruction data (hex):", instructionData.toString("hex"));

  return new TransactionInstruction({
    keys: accounts,
    programId: PROGRAM_ID,
    data: instructionData,
  });
}

/**
 * Sorts cookedData.seeds by mint address to match on-chain PDA derivation order.
 * Returns a new cookedData object with sorted seeds.
 *
 * @param {Object} cookedData - The cooked recipe data with seeds array.
 * @returns {Object} New cookedData object with seeds sorted by mint address.
 */
export function sortSeeds(cookedData) {
  if (!cookedData || typeof cookedData !== "object") {
    throw new Error("Invalid cookedData: Input must be an object.");
  }

  if (!Array.isArray(cookedData.seeds)) {
    throw new Error("Invalid cookedData: 'seeds' must be an array.");
  }

  if (!cookedData.seeds.every((s) => s.mint && s.amount_u64 !== undefined)) {
    throw new Error(
      "Invalid cookedData: Each seed must have 'mint' and 'amount_u64'."
    );
  }

  // Create a new cookedData object to avoid mutating the input
  const sortedCookedData = { ...cookedData };
  sortedCookedData.seeds = [...cookedData.seeds].sort((a, b) =>
    new PublicKey(a.mint).toBuffer().compare(new PublicKey(b.mint).toBuffer())
  );

  console.log(
    "Original seeds:",
    cookedData.seeds.map((s) => s.mint)
  );
  console.log(
    "Sorted seeds:",
    sortedCookedData.seeds.map((s) => s.mint)
  );

  return sortedCookedData;
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

  //allow seedSalt=""
  if (!("seedSalt" in cookedData)) {
    throw new Error("Invalid cookedData: Missing required field 'seedSalt'.");
  }

  if (!Array.isArray(cookedData.seeds)) {
    throw new Error("Invalid cookedData: 'seeds' must be an array.");
  }

  if (!cookedData.seeds.every((s) => s.mint && s.amount_u64 !== undefined)) {
    throw new Error(
      "Invalid cookedData: Each seed must have 'mint' and 'amount_u64'."
    );
  }

  console.log("cooked Data is Valid");

  // Return the destructured valid fields
  return cookedData;
}

//convert ui qty to u64
function toBaseUnits(amountStr, decimals) {
  const floatVal = parseFloat(amountStr);
  if (isNaN(floatVal)) throw new Error("Invalid number in qty_requested");

  const scaled = Math.floor(floatVal * 10 ** decimals); // avoid rounding issues
  return BigInt(scaled);
}

export async function useRecipe(
  feePayerPubkey,
  cookedData,
  tokenAccounts,
  option
) {
  if (![0x02, 0x03].includes(option)) {
    throw new Error("❌ Invalid option. Must be 0x02 (cook) or 0x03 (uncook).");
  }

  console.log("Calling cookRecipe");

  // Validate and destructure fields directly
  const { pda, seeds, seedSalt } = validateCookedDataForCooking(cookedData);

  // Check to make sure there are twice as many token accounts as seeds, plus 2 extra (index ATAs)
  if (tokenAccounts.length !== 2 * seeds.length + 2) {
    console.log("❌ Not enough token accounts.");
    console.log(
      "👉 To fix: pass all PDA token accounts and user token accounts for each mint."
    );
    console.log(`ℹ️ Received tokenAccounts.length: ${tokenAccounts.length}`);
    console.log(`ℹ️ Expected: ${2 * seeds.length + 2}`);
    return null;
  }

  let instructionData = Buffer.alloc(1);
  instructionData.writeUInt8(option, 0); // 0x01 = cook, 0x02 = uncook

  const pdaPubkey = new PublicKey(pda);

  let accounts = [
    { pubkey: feePayerPubkey, isSigner: true, isWritable: true }, // payer_account
    { pubkey: FEE_ACCOUNT_PUBKEY, isSigner: false, isWritable: true }, // fee_account
    { pubkey: CONFIG_ACCOUNT, isSigner: false, isWritable: false }, // config_account
    { pubkey: pdaPubkey, isSigner: false, isWritable: true }, // pda_account
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }, // rent_sysvar
  ];

  for (const seed of seeds) {
    if (seed.mint) {
      accounts.push({
        pubkey: new PublicKey(seed.mint),
        isSigner: false,
        isWritable: false,
      });
    }
  }

  // Handling amounts
  const amounts = seeds.map((s) => BigInt(s.amount_u64));
  const amountsLen = encodeU32(amounts.length);
  const amountsData = Buffer.concat(amounts.map(encodeU64));

  instructionData = Buffer.concat([instructionData, amountsLen, amountsData]);

  // Handling salt
  let saltBuffer = Buffer.alloc(32);
  const saltBytes = Buffer.from(seedSalt, "utf-8");
  saltBytes.copy(saltBuffer, 0, 0, Math.min(saltBytes.length, 32));

  instructionData = Buffer.concat([instructionData, saltBuffer]);

  // Assuming cookedData.qty_requested is like "2.5" from the UI
  const baseQty = toBaseUnits(cookedData.qty_requested, 6); // 2.5 -> 2500000n
  const qtyRequestedBuf = encodeU64(baseQty);

  // Final instruction buffer
  instructionData = Buffer.concat([instructionData, qtyRequestedBuf]);

  for (const tokenAccount of tokenAccounts) {
    accounts.push({
      pubkey: new PublicKey(tokenAccount),
      isSigner: false,
      isWritable: true,
    });
  }

  return new TransactionInstruction({
    keys: accounts,
    programId: PROGRAM_ID,
    data: instructionData,
  });
}
