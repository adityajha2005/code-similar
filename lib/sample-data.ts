import type { RepositoryInput } from "@/lib/types";

export const sampleRepositories: RepositoryInput[] = [
  {
    id: "seed-checkout",
    name: "checkout-service",
    source: "Seeded sample repository",
    files: [
      {
        path: "src/pricing/calculateCartTotal.ts",
        language: "TypeScript",
        content: `type CartItem = { price: number; quantity: number; discount?: number };

export function calculateCartTotal(items: CartItem[], taxRate = 0.08) {
  let subtotal = 0;

  for (const item of items) {
    const lineTotal = item.price * item.quantity;
    const discount = item.discount ?? 0;
    subtotal += Math.max(lineTotal - discount, 0);
  }

  const taxes = subtotal * taxRate;
  return {
    subtotal,
    taxes,
    total: subtotal + taxes,
  };
}
`,
      },
      {
        path: "src/pricing/calculateInvoiceTotal.ts",
        language: "TypeScript",
        content: `type InvoiceItem = { unitPrice: number; amount: number; deduction?: number };

export function calculateInvoiceTotal(items: InvoiceItem[], taxRate = 0.08) {
  let subtotal = 0;

  for (const entry of items) {
    const lineTotal = entry.unitPrice * entry.amount;
    const discount = entry.deduction ?? 0;
    subtotal += Math.max(lineTotal - discount, 0);
  }

  const taxes = subtotal * taxRate;
  return {
    subtotal,
    taxes,
    total: subtotal + taxes,
  };
}
`,
      },
      {
        path: "src/queue/retryJob.ts",
        language: "TypeScript",
        content: `export async function retryJob<T>(
  operation: () => Promise<T>,
  retries = 3,
  baseDelay = 150,
) {
  let attempt = 0;

  while (attempt <= retries) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }

      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt += 1;
    }
  }

  throw new Error("unreachable");
}
`,
      },
      {
        path: "src/auth/session.ts",
        language: "TypeScript",
        content: `export function buildSessionCookie(userId: string, expiresAt: Date) {
  return [
    "session=" + userId,
    "HttpOnly",
    "Secure",
    "Path=/",
    "Expires=" + expiresAt.toUTCString(),
  ].join("; ");
}
`,
      },
    ],
  },
  {
    id: "seed-analytics",
    name: "analytics-jobs",
    source: "Seeded sample repository",
    files: [
      {
        path: "jobs/billing/calculate_totals.py",
        language: "Python",
        content: `def calculate_totals(items, tax_rate=0.08):
    subtotal = 0

    for item in items:
        line_total = item["price"] * item["quantity"]
        discount = item.get("discount", 0)
        subtotal += max(line_total - discount, 0)

    taxes = subtotal * tax_rate
    return {
        "subtotal": subtotal,
        "taxes": taxes,
        "total": subtotal + taxes,
    }
`,
      },
      {
        path: "jobs/retries/backoff.py",
        language: "Python",
        content: `import asyncio

async def retry_job(operation, retries=3, base_delay=150):
    attempt = 0

    while attempt <= retries:
        try:
            return await operation()
        except Exception:
            if attempt == retries:
                raise

            delay = base_delay * (2 ** attempt)
            await asyncio.sleep(delay / 1000)
            attempt += 1

    raise RuntimeError("unreachable")
`,
      },
      {
        path: "jobs/users/normalize_profile.py",
        language: "Python",
        content: `def normalize_profile(payload):
    return {
        "id": payload["id"],
        "email": payload["email"].strip().lower(),
        "name": payload["name"].strip(),
    }
`,
      },
    ],
  },
];
