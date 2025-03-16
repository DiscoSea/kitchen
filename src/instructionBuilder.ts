/**
 * @file instructionBuilder.ts
 * @author azuldevgames@gmail.com
 * @description Module for handling instruction building operations.
 */

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { createHash } from "crypto";

import { PROGRAM_ID, METADATA_PROGRAM_ID, FEE_ACCOUNT } from "./constants.js";

import { CookedData } from "./types.js";

export const findCookPDA = (
  concatenatedData: Uint8Array,
  salt: string
): { pda: PublicKey; bump: number; sha256Hash: Uint8Array } => {
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
};

export default { findCookPDA };
