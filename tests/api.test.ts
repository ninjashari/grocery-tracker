import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";

// Point the singleton connection at a throwaway file before anything imports it.
const dir = mkdtempSync(join(tmpdir(), "grocery-test-"));
process.env["DB_PATH"] = join(dir, "test.db");

const { createApp } = await import("../server/index.ts");

let server: Server;
let base: string;

/** A signed-in client. Each one gets its own cookie jar, so households stay separate. */
function client() {
  let cookie = "";
  return async function call(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { cookie };
    let payload: string | undefined;
    if (typeof body === "string") {
      headers["content-type"] = "text/csv";
      payload = body;
    } else if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }

    const res = await fetch(base + path, { method, headers, body: payload });
    const setCookie = res.headers.getSetCookie();
    if (setCookie.length > 0) cookie = setCookie.map((entry) => entry.split(";")[0]).join("; ");

    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data: data as never };
  };
}

beforeAll(async () => {
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Server did not bind a port");
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

const R = (rupees: number) => Math.round(rupees * 100);

describe("auth", () => {
  it("creates a household with seeded categories on signup", async () => {
    const call = client();
    const signup = await call("POST", "/api/auth/signup", {
      email: "Owner@Example.com",
      password: "hunter2hunter2",
      name: "Owner",
      householdName: "Test House",
    });

    expect(signup.status).toBe(201);
    expect(signup.data["email"]).toBe("owner@example.com");

    const categories = await call("GET", "/api/categories");
    expect(categories.data).toHaveLength(12);
  });

  it("refuses a duplicate email and a wrong password", async () => {
    const call = client();
    const duplicate = await call("POST", "/api/auth/signup", {
      email: "owner@example.com",
      password: "hunter2hunter2",
      name: "Other",
      householdName: "Other",
    });
    expect(duplicate.status).toBe(409);

    const wrong = await call("POST", "/api/auth/login", {
      email: "owner@example.com",
      password: "not-the-password",
    });
    expect(wrong.status).toBe(401);
  });

  it("rejects API calls without a session", async () => {
    const anonymous = await fetch(`${base}/api/bills`);
    expect(anonymous.status).toBe(401);
  });
});

describe("bills", () => {
  it("saves a bill, its lines and any inline new items in one go", async () => {
    const call = client();
    await call("POST", "/api/auth/login", { email: "owner@example.com", password: "hunter2hunter2" });

    const categories = await call("GET", "/api/categories");
    const dairy = (categories.data as { id: number; name: string }[]).find((c) => c.name === "Dairy")!;

    const bill = await call("POST", "/api/bills", {
      billDate: "2026-09-08",
      shop: "DMart",
      paymentMethod: "UPI",
      statedTotalPaise: R(192),
      note: "weekly",
      lines: [
        { newItem: { brand: "Amul", name: "Milk", categoryId: dairy.id, defaultUnit: "L" }, quantity: 2, unit: "L", unitPricePaise: R(60) },
        { newItem: { brand: "", name: "Tomato", categoryId: null, defaultUnit: "kg" }, quantity: 1.5, unit: "kg", unitPricePaise: R(48) },
      ],
    });

    expect(bill.status).toBe(201);
    expect(bill.data["computedTotalPaise"]).toBe(R(192));
    expect(bill.data["lines"]).toHaveLength(2);

    // Base quantities are stored at write time; price history depends on them.
    expect(bill.data["lines"][0]).toMatchObject({ baseQuantity: 2000, baseUnit: "ml", lineTotalPaise: R(120) });
    expect(bill.data["lines"][1]).toMatchObject({ baseQuantity: 1500, baseUnit: "g", lineTotalPaise: R(72) });
  });

  it("rolls the whole bill back when one line is invalid", async () => {
    const call = client();
    await call("POST", "/api/auth/login", { email: "owner@example.com", password: "hunter2hunter2" });

    const before = await call("GET", "/api/items");
    const itemsBefore = (before.data as unknown[]).length;

    const bad = await call("POST", "/api/bills", {
      billDate: "2026-09-09",
      shop: "DMart",
      paymentMethod: "Cash",
      lines: [
        { newItem: { brand: "", name: "Should Not Exist", categoryId: null, defaultUnit: "pcs" }, quantity: 1, unit: "pcs", unitPricePaise: R(10) },
        // 9_999_999 is not an item in this household, so the transaction must abort.
        { itemId: 9_999_999, quantity: 1, unit: "pcs", unitPricePaise: R(10) },
      ],
    });

    expect(bad.status).toBe(404);

    const after = await call("GET", "/api/items");
    expect((after.data as unknown[]).length).toBe(itemsBefore);
    expect((after.data as { name: string }[]).some((item) => item.name === "Should Not Exist")).toBe(false);
  });

  it("normalises price history across units", async () => {
    const call = client();
    await call("POST", "/api/auth/login", { email: "owner@example.com", password: "hunter2hunter2" });

    const items = await call("GET", "/api/items?q=Milk");
    const milk = (items.data as { id: number }[])[0]!;

    // Same rate as 2 L at Rs 60/L, expressed in millilitres.
    await call("POST", "/api/bills", {
      billDate: "2026-09-20",
      shop: "Local Kirana",
      paymentMethod: "Cash",
      lines: [{ itemId: milk.id, quantity: 500, unit: "ml", unitPricePaise: R(0.06) }],
    });

    const history = await call("GET", `/api/reports/price-history?itemId=${milk.id}`);
    const points = history.data["points"] as { basePricePaise: number }[];

    expect(points).toHaveLength(2);
    expect(points[0]!.basePricePaise).toBe(600); // Rs 6.00 per 100 ml
    expect(points[1]!.basePricePaise).toBe(600); // identical despite the different unit
    expect(history.data["changeVsFirstPct"]).toBe(0);
  });

  it("reconciles spend reports against the bills that feed them", async () => {
    const call = client();
    await call("POST", "/api/auth/login", { email: "owner@example.com", password: "hunter2hunter2" });

    const bills = await call("GET", "/api/bills");
    const expected = (bills.data as { computedTotalPaise: number }[]).reduce(
      (sum, bill) => sum + bill.computedTotalPaise,
      0,
    );

    for (const groupBy of ["month", "category", "shop", "paymentMethod"]) {
      const report = await call("GET", `/api/reports/spend?groupBy=${groupBy}`);
      expect(report.data["totalPaise"], `grouped by ${groupBy}`).toBe(expected);
    }
  });
});

describe("household isolation", () => {
  it("hides one household's data from another", async () => {
    const owner = client();
    await owner("POST", "/api/auth/login", { email: "owner@example.com", password: "hunter2hunter2" });
    const ownerBills = await owner("GET", "/api/bills");
    const ownerBillId = (ownerBills.data as { id: number }[])[0]!.id;
    const ownerItems = await owner("GET", "/api/items");
    const ownerItemId = (ownerItems.data as { id: number }[])[0]!.id;

    const stranger = client();
    await stranger("POST", "/api/auth/signup", {
      email: "stranger@example.com",
      password: "hunter2hunter2",
      name: "Stranger",
      householdName: "Elsewhere",
    });

    expect((await stranger("GET", "/api/bills")).data).toEqual([]);
    expect((await stranger("GET", "/api/items")).data).toEqual([]);
    expect((await stranger("GET", `/api/bills/${ownerBillId}`)).status).toBe(404);
    expect((await stranger("GET", `/api/items/${ownerItemId}`)).status).toBe(404);

    // An item id smuggled in from another household must not be accepted on a bill line.
    const smuggled = await stranger("POST", "/api/bills", {
      billDate: "2026-09-08",
      shop: "Anywhere",
      paymentMethod: "Cash",
      lines: [{ itemId: ownerItemId, quantity: 1, unit: "pcs", unitPricePaise: 100 }],
    });
    expect(smuggled.status).toBe(404);
  });

  it("shares data between members of the same household", async () => {
    const owner = client();
    await owner("POST", "/api/auth/login", { email: "owner@example.com", password: "hunter2hunter2" });
    const invited = await owner("POST", "/api/auth/invite", {
      email: "partner@example.com",
      password: "hunter2hunter2",
      name: "Partner",
    });
    expect(invited.status).toBe(201);

    const partner = client();
    await partner("POST", "/api/auth/login", { email: "partner@example.com", password: "hunter2hunter2" });

    const ownerBills = await owner("GET", "/api/bills");
    const partnerBills = await partner("GET", "/api/bills");
    expect(partnerBills.data).toEqual(ownerBills.data);
  });
});

describe("csv import", () => {
  const csv = [
    "bill_date,shop,payment_method,brand,item_name,category,quantity,unit,unit_price,line_total",
    "2026-10-01,BigBasket,Card,Tata,Tea,Beverages,250,g,0.90,225.00",
    "2026-10-01,BigBasket,Card,,Onion,Produce,2,kg,30.00,60.00",
    "2026-10-05,BigBasket,Card,,Bad Row,Produce,0,kg,30.00,60.00",
  ].join("\r\n");

  it("previews without writing anything", async () => {
    const call = client();
    await call("POST", "/api/auth/login", { email: "owner@example.com", password: "hunter2hunter2" });

    const before = await call("GET", "/api/bills");
    const preview = await call("POST", "/api/data/import/preview", csv);

    expect(preview.data["billCount"]).toBe(1); // the two 2026-10-01 rows group into one bill
    expect(preview.data["lineCount"]).toBe(2);
    expect(preview.data["errors"]).toHaveLength(1); // the zero-quantity row
    expect(preview.data["newItems"]).toContain("Tata Tea");
    expect(preview.data["newShops"]).toContain("BigBasket");

    const after = await call("GET", "/api/bills");
    expect(after.data).toEqual(before.data);
  });

  it("commits what the preview promised, skipping bad rows", async () => {
    const call = client();
    await call("POST", "/api/auth/login", { email: "owner@example.com", password: "hunter2hunter2" });

    const result = await call("POST", "/api/data/import", { csv, confirm: true });
    expect(result.status).toBe(201);
    expect(result.data).toMatchObject({ billsCreated: 1, linesCreated: 2, skippedRows: 1 });

    const bills = await call("GET", "/api/bills?from=2026-10-01&to=2026-10-01");
    expect(bills.data).toHaveLength(1);
    expect((bills.data as { computedTotalPaise: number }[])[0]!.computedTotalPaise).toBe(R(285));
  });

  it("re-imports an export without duplicating items or categories", async () => {
    const call = client();
    await call("POST", "/api/auth/login", { email: "owner@example.com", password: "hunter2hunter2" });

    const exported = await call("GET", "/api/data/export.csv");
    const itemsBefore = ((await call("GET", "/api/items?includeArchived=true")).data as unknown[]).length;
    const categoriesBefore = ((await call("GET", "/api/categories")).data as unknown[]).length;

    const result = await call("POST", "/api/data/import", { csv: exported.data, confirm: true });
    expect(result.data["itemsCreated"]).toBe(0);
    expect(result.data["categoriesCreated"]).toBe(0);

    expect(((await call("GET", "/api/items?includeArchived=true")).data as unknown[]).length).toBe(itemsBefore);
    expect(((await call("GET", "/api/categories")).data as unknown[]).length).toBe(categoriesBefore);
  });

  /**
   * Receipts disagree with their own line sums by a rounding paisa, so the printed total
   * is data in its own right. It has to survive a round trip.
   */
  it("carries the printed bill total through export and back", async () => {
    const call = client();
    await call("POST", "/api/auth/login", { email: "owner@example.com", password: "hunter2hunter2" });

    // Lines sum to Rs 100.02 but the receipt said Rs 100.00.
    const original = await call("POST", "/api/bills", {
      billDate: "2026-11-11",
      shop: "Rounding Mart",
      paymentMethod: "Card",
      statedTotalPaise: R(100),
      lines: [
        { newItem: { brand: "", name: "Odd Weight Item", categoryId: null, defaultUnit: "kg" }, quantity: 0.795, unit: "kg", unitPricePaise: R(27) },
        { newItem: { brand: "", name: "Round Item", categoryId: null, defaultUnit: "pcs" }, quantity: 1, unit: "pcs", unitPricePaise: R(78.55) },
      ],
    });
    expect(original.data["statedTotalPaise"]).toBe(R(100));
    expect(original.data["computedTotalPaise"]).toBe(R(100.02));

    const exported = (await call("GET", "/api/data/export.csv")).data as unknown as string;
    expect(exported.split("\r\n")[0]).toContain("bill_total");

    await call("DELETE", `/api/bills/${original.data["id"]}`);
    await call("POST", "/api/data/import", { csv: exported, confirm: true });

    const restored = await call("GET", "/api/bills?from=2026-11-11&to=2026-11-11");
    const bill = (restored.data as { statedTotalPaise: number; computedTotalPaise: number }[])[0]!;

    expect(bill.statedTotalPaise).toBe(R(100));
    expect(bill.computedTotalPaise).toBe(R(100.02));
  });

  it("rejects a CSV missing required columns", async () => {
    const call = client();
    await call("POST", "/api/auth/login", { email: "owner@example.com", password: "hunter2hunter2" });

    const bad = await call("POST", "/api/data/import/preview", "foo,bar\r\n1,2\r\n");
    expect(bad.status).toBe(400);
    expect(String(bad.data["error"])).toMatch(/missing required column/i);
  });
});

describe("catalog rules", () => {
  it("archives items that appear on bills and deletes ones that do not", async () => {
    const call = client();
    await call("POST", "/api/auth/login", { email: "owner@example.com", password: "hunter2hunter2" });

    const unused = await call("POST", "/api/items", { name: "Never Bought", categoryId: null, defaultUnit: "pcs" });
    expect((await call("DELETE", `/api/items/${unused.data["id"]}`)).status).toBe(204);

    const used = (await call("GET", "/api/items?q=Milk")).data as { id: number }[];
    const archived = await call("DELETE", `/api/items/${used[0]!.id}`);
    expect(archived.status).toBe(200);
    expect(archived.data["archived"]).toBe(true);

    // Archived items drop out of pickers but stay in reports.
    const visible = (await call("GET", "/api/items?q=Milk")).data as unknown[];
    expect(visible).toHaveLength(0);

    await call("PATCH", `/api/items/${used[0]!.id}`, { archived: false });
  });

  it("will not delete a category that items still use without a destination", async () => {
    const call = client();
    await call("POST", "/api/auth/login", { email: "owner@example.com", password: "hunter2hunter2" });

    const categories = (await call("GET", "/api/categories")).data as { id: number; name: string; itemCount: number }[];
    const inUse = categories.find((category) => category.itemCount > 0)!;
    const target = categories.find((category) => category.id !== inUse.id)!;

    expect((await call("DELETE", `/api/categories/${inUse.id}`)).status).toBe(400);
    expect((await call("DELETE", `/api/categories/${inUse.id}?reassignTo=${target.id}`)).status).toBe(204);

    const remaining = (await call("GET", "/api/categories")).data as { id: number }[];
    expect(remaining.some((category) => category.id === inUse.id)).toBe(false);
  });
});
