import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";
import { createRecipe } from "../src/index.js"; // Adjust path if needed

describe("createRecipe Function", function () {
  it("should throw an error if cookedData is missing fields", async function () {
    const feePayerPubkey = new PublicKey(
      "4PYfccDjZpjthkDkKPGQHEZXtSooRwgHCQJTig4myc7x"
    );
    const invalidData = {}; // Missing everything

    try {
      await createRecipe(feePayerPubkey, invalidData);
      throw new Error("Test failed: Expected function to throw an error.");
    } catch (error) {
      expect(error.message).to.equal(
        "Invalid cookedData: Missing required field 'seeds'."
      );
    }
  });

  it("should throw an error if seeds are not an array", async function () {
    const feePayerPubkey = new PublicKey(
      "4PYfccDjZpjthkDkKPGQHEZXtSooRwgHCQJTig4myc7x"
    );
    const invalidData = {
      seeds: "not-an-array",
      salt: "random-salt",
      metadataCid: "some-metadata-cid",
      name: "Test Recipe",
      symbol: "TST",
    };

    try {
      await createRecipe(feePayerPubkey, invalidData);
      throw new Error("Test failed: Expected function to throw an error.");
    } catch (error) {
      expect(error.message).to.equal(
        "Invalid cookedData: 'seeds' must be an array."
      );
    }
  });

  it("should throw an error if a seed is missing required properties", async function () {
    const feePayerPubkey = new PublicKey(
      "4PYfccDjZpjthkDkKPGQHEZXtSooRwgHCQJTig4myc7x"
    );
    const invalidData = {
      seeds: [{ mint: "4o5wmhvHtF8JuauJgrzWpR6dyCNQJn9MYwCHNUhBXxve" }], // missing amount_u64
      salt: "random-salt",
      metadataCid: "some-metadata-cid",
      name: "Test Recipe",
      symbol: "TST",
    };

    try {
      await createRecipe(feePayerPubkey, invalidData);
      throw new Error("Test failed: Expected function to throw an error.");
    } catch (error) {
      expect(error.message).to.equal(
        "Invalid cookedData: Each seed must have 'mint' and 'amount_u64'."
      );
    }
  });

  it("should return a TransactionInstruction for valid input", async function () {
    const feePayerPubkey = new PublicKey(
      "4PYfccDjZpjthkDkKPGQHEZXtSooRwgHCQJTig4myc7x"
    );

    const validData = {
      seeds: [
        {
          mint: "4o5wmhvHtF8JuauJgrzWpR6dyCNQJn9MYwCHNUhBXxve",
          amount_u64: "1000000", // should be stringified
        },
      ],
      salt: "random-salt",
      metadataCid: "some-metadata-cid",
      name: "Test Recipe",
      symbol: "TST",
    };

    try {
      const result = await createRecipe(feePayerPubkey, validData);
      console.log("DEBUG RESULT:", result);
      expect(result).to.be.an("object");
      expect(result.keys).to.be.an("array").that.is.not.empty;
    } catch (error) {
      console.error("Test Failed with Error:", error);
      throw error;
    }
  });
});
