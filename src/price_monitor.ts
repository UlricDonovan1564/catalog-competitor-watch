import { z } from "zod";

export const catalogCheckSchema = z.object({
  sku: z.string().min(1),
  productName: z.string().min(1),
  currentPrice: z.number().nonnegative(),
  competitorDomains: z.array(z.string().min(1)).min(1),
  checkout: z.object({ currency: z.string().length(3), cartId: z.string().min(1) }),
  fulfillment: z.object({ method: z.enum(["ship", "pickup"]), status: z.enum(["pending", "allocated", "dispatched"]) }),
  receipt: z.object({ receiptId: z.string().min(1), issuedAt: z.string().datetime() }),
  customerUpdate: z.object({ orderId: z.string().min(1), status: z.enum(["confirmed", "processing", "fulfilled"]) }),
});

export type CatalogCheck = z.infer<typeof catalogCheckSchema>;

export type CompetitorObservation = {
  domain: string;
  amount: number;
  url: string;
};

export type CatalogDecision = {
  sku: string;
  action: "review" | "keep";
  lowestObserved: number | null;
  orderUpdate: { orderId: string; status: CatalogCheck["customerUpdate"]["status"] };
  evidence: CompetitorObservation[];
};

export function decideCatalogAction(
  input: CatalogCheck,
  observations: CompetitorObservation[],
): CatalogDecision {
  const comparable = observations.filter((item) => item.amount >= 0);
  const lowestObserved = comparable.length
    ? Math.min(...comparable.map((item) => item.amount))
    : null;
  const action = lowestObserved !== null && lowestObserved < input.currentPrice ? "review" : "keep";

  return {
    sku: input.sku,
    action,
    lowestObserved,
    orderUpdate: {
      orderId: input.customerUpdate.orderId!,
      status: input.customerUpdate.status!,
    },
    evidence: comparable,
  };
}
