import type {
  ApiError,
  Bill,
  BillSummary,
  Category,
  ImportPreview,
  ImportResult,
  Item,
  ItemPurchase,
  PriceHistory,
  PriceHistoryByName,
  SpendReport,
  TopItem,
  User,
} from "@shared/types.ts";
import type { BillInput, ItemCreateInput, ItemUpdateInput, PaymentMethod, SpendGrouping } from "@shared/schemas.ts";

/** An API error carrying the server's per-field messages, so forms can show them inline. */
export class ApiRequestError extends Error {
  status: number;
  fields: Record<string, string>;

  constructor(status: number, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.fields = fields;
  }
}

type RequestOptions = { method?: string; body?: unknown; raw?: boolean };

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, raw = false } = options;

  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (typeof body === "string") {
    headers["Content-Type"] = "text/csv";
    payload = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const response = await fetch(`/api${path}`, {
    method,
    headers,
    body: payload,
    credentials: "include",
  });

  if (response.status === 204) return undefined as T;

  if (raw) {
    const text = await response.text();
    if (!response.ok) throw new ApiRequestError(response.status, text || response.statusText);
    return text as T;
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const error = (data ?? {}) as ApiError;
    throw new ApiRequestError(response.status, error.error ?? response.statusText, error.fields ?? {});
  }

  return data as T;
}

const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
};

export type Shop = { shop: string; billCount: number; lastUsed: string };

export type ItemName = { name: string; purchaseCount: number };

export type Summary = {
  totalPaise: number;
  billCount: number;
  itemCount: number;
  currentMonth: { month: string; totalPaise: number } | null;
  previousMonth: { month: string; totalPaise: number } | null;
};

export type Member = { id: string; email: string; name: string; createdAt: string };

export const api = {
  signup: (body: { email: string; password: string; name: string; householdName: string }) =>
    request<User>("/auth/signup", { method: "POST", body }),
  login: (body: { email: string; password: string }) =>
    request<User>("/auth/login", { method: "POST", body }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  me: () => request<User>("/auth/me"),
  invite: (body: { email: string; password: string; name: string }) =>
    request<User>("/auth/invite", { method: "POST", body }),
  members: () => request<Member[]>("/auth/members"),

  categories: () => request<Category[]>("/categories"),
  createCategory: (name: string) => request<Category>("/categories", { method: "POST", body: { name } }),
  updateCategory: (id: string, body: { name?: string; sortOrder?: number }) =>
    request<Category>(`/categories/${id}`, { method: "PATCH", body }),
  deleteCategory: (id: string, reassignTo?: string) =>
    request<void>(`/categories/${id}${qs({ reassignTo })}`, { method: "DELETE" }),

  items: (params: { q?: string; categoryId?: string; includeArchived?: boolean } = {}) =>
    request<Item[]>(`/items${qs(params)}`),
  item: (id: string) => request<Item>(`/items/${id}`),
  createItem: (body: ItemCreateInput) => request<Item>("/items", { method: "POST", body }),
  updateItem: (id: string, body: ItemUpdateInput) =>
    request<Item>(`/items/${id}`, { method: "PATCH", body }),
  deleteItem: (id: string) => request<{ archived: true; item: Item } | void>(`/items/${id}`, { method: "DELETE" }),
  shops: () => request<Shop[]>("/items/shops"),
  itemNames: (q?: string) => request<ItemName[]>(`/items/names${qs({ q })}`),
  itemBills: (itemId: string) => request<ItemPurchase[]>(`/items/${itemId}/bills`),

  bills: (
    params: {
      from?: string;
      to?: string;
      shop?: string;
      categoryId?: string;
      paymentMethod?: PaymentMethod;
      limit?: number;
      offset?: number;
    } = {},
  ) =>
    request<BillSummary[]>(`/bills${qs(params)}`),
  bill: (id: string) => request<Bill>(`/bills/${id}`),
  createBill: (body: BillInput) => request<Bill>("/bills", { method: "POST", body }),
  updateBill: (id: string, body: BillInput) => request<Bill>(`/bills/${id}`, { method: "PATCH", body }),
  deleteBill: (id: string) => request<void>(`/bills/${id}`, { method: "DELETE" }),

  spend: (params: { from?: string; to?: string; groupBy?: SpendGrouping; categoryId?: string } = {}) =>
    request<SpendReport>(`/reports/spend${qs(params)}`),
  priceHistory: (itemId: string) => request<PriceHistory>(`/reports/price-history${qs({ itemId })}`),
  priceHistoryAllBrands: (name: string) =>
    request<PriceHistoryByName>(`/reports/price-history-all-brands${qs({ name })}`),
  topItems: (params: { from?: string; to?: string; metric?: "spend" | "quantity"; limit?: number } = {}) =>
    request<TopItem[]>(`/reports/top-items${qs(params)}`),
  summary: () => request<Summary>("/reports/summary"),

  exportCsv: () => request<string>("/data/export.csv", { raw: true }),
  importPreview: (csv: string) => request<ImportPreview>("/data/import/preview", { method: "POST", body: csv }),
  importCommit: (csv: string) =>
    request<ImportResult & { skippedRows: number }>("/data/import", {
      method: "POST",
      body: { csv, confirm: true },
    }),
};
