# 🍳 @discosea/kitchen

Composable token instructions for Solana.
Build and use on-chain "recipes" that combine multiple SPL tokens into unified index tokens — and split them back.
Built for use with DeFi apps, games, and meme projects.

> **As seen on [cookthecoins.com](https://cookthecoins.com)**

---

## 📦 Installation

```bash
npm install @discosea/kitchen
```

---

## 🧰 Exports

- `createRecipe(feePayerPubkey, cookedData)`
- `useRecipe(feePayerPubkey, cookedData, tokenAccounts, option)`
- `findCookPDA(concatenatedData, salt)`

---

## 🥘 createRecipe

Creates a `TransactionInstruction` to define a new on-chain recipe.

```ts
import { createRecipe } from "@discosea/kitchen";
import { PublicKey } from "@solana/web3.js";

const cookedData = {
  pda: "RecipePDA",
  seeds: [
    { mint: "MintAddress1", amount_u64: "1000000" },
    { mint: "MintAddress2", amount_u64: "2000000" },
  ],
  salt: "unique-salt-string",
  metadataCid: "QmYourIPFSCid",
  name: "My Token Index",
  symbol: "MTI",
};

const ix = await createRecipe(new PublicKey("FEE_PAYER_PUBKEY"), cookedData);
```

---

## 🍳 useRecipe

Returns a `TransactionInstruction` for `cook` (mint) or `uncook` (burn).

```ts
import { useRecipe } from "@discosea/kitchen";

const cookedData = {
  pda: "RecipePDA",
  seeds: [
    { mint: "MintAddress1", amount_u64: "1000000" },
    { mint: "MintAddress2", amount_u64: "2000000" },
  ],
  seedSalt: "unique-salt-string",
  qty_requested: "2.5",
};

const tokenAccounts = [
  "PDA_Seed1",
  "USER_Seed1",
  "PDA_Seed2",
  "USER_Seed2",
  "PDA_IndexToken",
  "USER_IndexToken",
];

const ix = await useRecipe(
  new PublicKey("FEE_PAYER_PUBKEY"),
  cookedData,
  tokenAccounts,
  0x02 // 0x02 = cook, 0x03 = uncook
);
```

---

## 🧪 findCookPDA

Deterministically derive a PDA for a recipe.

```ts
import { findCookPDA } from "@discosea/kitchen";

const concatenated = Buffer.concat([
  Buffer.from("Seed1"),
  Buffer.from("Seed2"),
]);

const { pda, bump, sha256Hash } = findCookPDA(concatenated, "salt");
```

---

## 🛠️ Notes

- Seed amounts must be passed as raw `amount_u64` (base units, not UI format)
- `qty_requested` is a UI float (e.g. "2.5") and converted internally
- PDA and metadata CID must be precomputed externally

---

## 🧾 License

MIT © [DiscoSea](https://cookthecoins.com)
