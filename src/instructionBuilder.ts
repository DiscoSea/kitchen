import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { encodeU32, encodeU64, encodeString } from "./utils";
import { PROGRAM_ID, METADATA_PROGRAM_ID, FEE_ACCOUNT } from "./constants";

import { CookedData } from "./types";

/**
 * Creates a Solana transaction instruction to merge SPL tokens.
 * @param feePayer - The wallet that will pay for the transaction.
 * @param cookedData - The structured input containing PDA, metadata, and seeds.
 * @returns TransactionInstruction to be added to a transaction.
 */
export function createRecipe(
  feePayer: PublicKey,
  cookedData: CookedData
): TransactionInstruction {
  if (!(feePayer instanceof PublicKey)) {
    throw new Error("Invalid feePayer: Must be a PublicKey instance.");
  }

  if (!cookedData) {
    throw new Error("Cooked data is required.");
  }

  const { pda, seeds, salt, metadataCid, name, symbol } = cookedData;
  if (!pda || !seeds?.length || !metadataCid || !name || !symbol) {
    throw new Error(
      "Invalid cooked data: Missing required fields (pda, seeds, metadataCid, name, or symbol)."
    );
  }

  const uri = `https://ipfs.io/ipfs/${metadataCid}`;
  const pdaPubkey = new PublicKey(pda);
  const [metadataPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      METADATA_PROGRAM_ID.toBuffer(),
      pdaPubkey.toBuffer(),
    ],
    METADATA_PROGRAM_ID
  );

  let accounts = [
    { pubkey: feePayer, isSigner: true, isWritable: true },
    { pubkey: FEE_ACCOUNT, isSigner: false, isWritable: false },
    { pubkey: pdaPubkey, isSigner: false, isWritable: true },
    { pubkey: metadataPda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
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

  let instructionData = Buffer.alloc(1);
  instructionData.writeUInt8(0x01, 0);

  const amounts = seeds
    .filter((s) => s.mint && s.amount_u64 !== undefined) // Ensure amount_u64 exists
    .map((s) => s.amount_u64 as number); // TypeScript: Cast to number to remove undefined

  const amountsLen = encodeU32(amounts.length);

  const amountsData = Buffer.concat(amounts.map((amount) => encodeU64(amount)));

  instructionData = Buffer.concat([instructionData, amountsLen, amountsData]);

  let saltBuffer = Buffer.alloc(32);
  Buffer.from(salt, "utf-8").copy(saltBuffer, 0, 0, Math.min(salt.length, 32));
  instructionData = Buffer.concat([instructionData, saltBuffer]);

  const nameData = encodeString(name);
  const symbolData = encodeString(symbol);
  const uriData = encodeString(uri);
  instructionData = Buffer.concat([
    instructionData,
    nameData,
    symbolData,
    uriData,
  ]);

  return new TransactionInstruction({
    keys: accounts,
    programId: PROGRAM_ID,
    data: instructionData,
  });
}
