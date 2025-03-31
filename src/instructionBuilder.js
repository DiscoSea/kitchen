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

function validateCookedData(cookedData) {
  if (!cookedData || typeof cookedData !== "object") {
    throw new Error("Invalid cookedData: Input must be an object.");
  }

  const requiredFields = [
    "pda",
    "seeds",
    "salt",
    "metadataCid",
    "name",
    "symbol",
  ];
  for (const field of requiredFields) {
    if (!cookedData[field]) {
      throw new Error(`Invalid cookedData: Missing required field '${field}'.`);
    }
  }

  if (!Array.isArray(cookedData.seeds)) {
    throw new Error("Invalid cookedData: 'seeds' must be an array.");
  }

  if (!cookedData.seeds.every((s) => s.mint && s.amount_u64 !== undefined)) {
    throw new Error(
      "Invalid cookedData: Each seed must have 'mint' and 'amount_u64'."
    );
  }

  // Return the destructured valid fields
  return cookedData;
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
    { pubkey: FEE_ACCOUNT_PUBKEY, isSigner: false, isWritable: false }, // fee_account
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

export async function cookRecipe(feePayerPubkey, cookedData, tokenAccounts) {
  console.log("Calling cookRecipe");

  // Validate and destructure fields directly
  const { pda, seeds, salt, metadataCid, name, symbol } =
    validateCookedData(cookedData);

  //check to make sure there are twice as many tokenAccounts then seeds
  if (tokenAccounts.length !== 2 * seeds.length) {
    console.log(
      "NotEnough TokenAccounts,To fix pass all PDA accounts and User TokenAccounts for each mint"
    );
    return null;
  }

  let instructionData = Buffer.alloc(1);
  instructionData.writeUInt8(0x02, 0);

  const pdaPubkey = new PublicKey(pda);
  const metadataPda = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      METADATA_PROGRAM_ID.toBuffer(),
      pdaPubkey.toBuffer(),
    ],
    METADATA_PROGRAM_ID
  );

  let accounts = [
    { pubkey: feePayerPubkey, isSigner: true, isWritable: true }, // payer_account
    { pubkey: FEE_ACCOUNT_PUBKEY, isSigner: false, isWritable: false }, // fee_account
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

  for (const tokenAccount of tokenAccounts) {
    if (tokenAccount.mint) {
      accounts.push({
        pubkey: new PublicKey(tokenAccount.mint),
        isSigner: false,
        isWritable: true,
      });
    }
  }

  return new TransactionInstruction({
    keys: accounts,
    programId: PROGRAM_ID,
    data: instructionData,
  });
}
