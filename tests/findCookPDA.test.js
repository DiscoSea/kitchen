import { expect } from "chai";
import { findCookPDA } from "../src/index.js"; // Adjust if necessary
import { PublicKey } from "@solana/web3.js";

describe("findCookPDA Function", function () {
  it("should return a valid PDA, bump, and SHA-256 hash", function () {
    const concatenatedData = new Uint8Array(32).fill(1); // Example data
    const salt = "random-salt";

    const result = findCookPDA(concatenatedData, salt);

    console.log("DEBUG PDA:", result.pda.toBase58());
    console.log("DEBUG Bump:", result.bump);
    console.log(
      "DEBUG SHA256:",
      Buffer.from(result.sha256Hash).toString("hex")
    );

    expect(result).to.be.an("object");
    expect(result.pda).to.be.instanceOf(PublicKey);
    expect(result.pda.toBase58()).to.be.a("string").with.length.greaterThan(0);
    expect(result.bump).to.be.a("number").that.is.gte(0);
    expect(result.sha256Hash).to.be.instanceOf(Uint8Array);
    expect(result.sha256Hash.length).to.equal(32);
  });

  it("should produce different PDAs for different salts", function () {
    const concatenatedData = new Uint8Array(32).fill(1);

    const result1 = findCookPDA(concatenatedData, "salt1");
    const result2 = findCookPDA(concatenatedData, "salt2");

    console.log("DEBUG PDA 1:", result1.pda.toBase58());
    console.log("DEBUG PDA 2:", result2.pda.toBase58());

    expect(result1.pda.toBase58()).to.not.equal(result2.pda.toBase58());
  });
});
