import { PublicKey } from "@solana/web3.js";

/**
 * Represents a seed entry in the transaction.
 */
export interface Seed {
  mint?: string;
  amount_u64?: number;
}

/**
 * Represents the required data for creating a recipe.
 */
export interface CookedData {
  pda: string;
  seeds: Seed[];
  salt: string;
  metadataCid: string;
  name: string;
  symbol: string;
}
