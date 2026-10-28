import assert from "node:assert/strict";
import test from "node:test";
import { catalogCheckSchema, decideCatalogAction } from "../src/price_monitor.js";

test("routes a lower competitor observation to review while preserving the customer update", () => {
  const input = catalogCheckSchema.parse({
    sku: "shoe-42",
    productName: "Trail Shoe",
    currentPrice: 120,
    competitorDomains: ["shop.example"],
    checkout: { currency: "USD", cartId: "cart-7" },
    fulfillment: { method: "ship", status: "allocated" },
    receipt: { receiptId: "receipt-7", issuedAt: "2026-09-28T08:00:00.000Z" },
    customerUpdate: { orderId: "order-7", status: "processing" },
  });

  const result = decideCatalogAction(input, [
    { domain: "shop.example", amount: 109, url: "https://shop.example/trail-shoe" },
  ]);

  assert.equal(result.action, "review");
  assert.equal(result.lowestObserved, 109);
  assert.deepEqual(result.orderUpdate, { orderId: "order-7", status: "processing" });
});
