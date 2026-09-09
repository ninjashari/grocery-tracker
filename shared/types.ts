import type { PaymentMethod } from "./schemas.ts";
import type { BaseUnit, Unit } from "./units.ts";

/** Shapes returned by the API. The client types its responses against these. */

export type User = {
  id: number;
  email: string;
  name: string;
  householdId: number;
  householdName: string;
};

export type Category = {
  id: number;
  name: string;
  sortOrder: number;
  itemCount: number;
};

export type Item = {
  id: number;
  brand: string;
  name: string;
  categoryId: number | null;
  categoryName: string | null;
  defaultUnit: Unit;
  archived: boolean;
  /** Unit price of the most recent purchase, used to prefill bill entry. */
  lastUnitPricePaise: number | null;
  lastUnit: Unit | null;
  lastPurchasedOn: string | null;
  purchaseCount: number;
};

export type BillLine = {
  id: number;
  itemId: number;
  brand: string;
  itemName: string;
  categoryName: string | null;
  quantity: number;
  unit: Unit;
  unitPricePaise: number;
  lineTotalPaise: number;
  baseQuantity: number;
  baseUnit: BaseUnit;
};

export type BillSummary = {
  id: number;
  billDate: string;
  shop: string;
  paymentMethod: PaymentMethod;
  statedTotalPaise: number | null;
  computedTotalPaise: number;
  note: string;
  lineCount: number;
  createdByName: string;
};

export type Bill = BillSummary & { lines: BillLine[] };

export type SpendBucket = {
  key: string;
  label: string;
  totalPaise: number;
  billCount: number;
  lineCount: number;
};

export type SpendReport = {
  groupBy: string;
  from: string | null;
  to: string | null;
  totalPaise: number;
  buckets: SpendBucket[];
};

export type PricePoint = {
  billId: number;
  billDate: string;
  shop: string;
  quantity: number;
  unit: Unit;
  unitPricePaise: number;
  lineTotalPaise: number;
  baseQuantity: number;
  baseUnit: BaseUnit;
  /** Price per 100 g / 100 ml / pc, in paise. Comparable across units. */
  basePricePaise: number;
};

export type PriceHistory = {
  item: Item;
  baseUnit: BaseUnit | null;
  points: PricePoint[];
  firstBasePricePaise: number | null;
  latestBasePricePaise: number | null;
  changeVsFirstPct: number | null;
  changeVsPreviousPct: number | null;
};

export type TopItem = {
  itemId: number;
  brand: string;
  itemName: string;
  categoryName: string | null;
  totalPaise: number;
  totalBaseQuantity: number;
  baseUnit: BaseUnit;
  purchaseCount: number;
};

export type ImportRowError = { row: number; message: string };

export type ImportPreview = {
  billCount: number;
  lineCount: number;
  newItems: string[];
  newCategories: string[];
  newShops: string[];
  totalPaise: number;
  errors: ImportRowError[];
};

export type ImportResult = {
  billsCreated: number;
  linesCreated: number;
  itemsCreated: number;
  categoriesCreated: number;
};

export type ApiError = {
  error: string;
  /** Field-level messages from zod, keyed by dotted field path. */
  fields?: Record<string, string>;
};
