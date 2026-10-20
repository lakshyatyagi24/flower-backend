import { BadRequestException } from '@nestjs/common';

export interface OrderItemInput {
  productId: number;
  quantity: number;
}

export interface ProductRow {
  id: number;
  name: string;
  price: number;
  stock: number;
  active: boolean;
  saleMode: 'PURCHASE' | 'ENQUIRY';
  gstRate: number;
  minOrderQty: number;
}

export interface TaxLine {
  lineTotal: number;
  gstRate: number;
}

export interface OrderItemRow {
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  gstRate: number;
  gstAmount: number;
}

function assertStockAvailable(product: ProductRow, qty: number): void {
  if (qty <= product.stock) return;
  throw new BadRequestException(
    product.stock <= 0 ? `"${product.name}" is out of stock` : `Only ${product.stock} of "${product.name}" available`,
  );
}

/** Throws the shopper-facing error for the first reason this line cannot be ordered; returns the quantity. */
function validateLine(product: ProductRow, requested: number): number {
  if (!product.active) throw new BadRequestException(`Product "${product.name}" is not available`);
  if (product.saleMode === 'ENQUIRY') {
    throw new BadRequestException(`"${product.name}" is enquiry-only — please send an enquiry instead`);
  }
  const qty = Math.floor(requested || 1);
  // Never silently bump the quantity (and the amount charged): the shopper must see the minimum.
  const minQty = product.minOrderQty || 1;
  if (qty < minQty) {
    throw new BadRequestException(`"${product.name}" has a minimum order of ${minQty}`);
  }
  assertStockAvailable(product, qty);
  return qty;
}

/** Validates every requested line against its product and prices it (server-side; never trusts the client). */
export function buildOrderItems(
  items: OrderItemInput[],
  productMap: Map<number, ProductRow>,
): { itemRows: OrderItemRow[]; taxLines: TaxLine[]; subtotal: number } {
  let subtotal = 0;
  const taxLines: TaxLine[] = [];
  const itemRows = items.map((it) => {
    const product = productMap.get(it.productId)!;
    const qty = validateLine(product, it.quantity);
    const lineTotal = product.price * qty;
    const gstRate = product.gstRate || 0;
    subtotal += lineTotal;
    taxLines.push({ lineTotal, gstRate });
    return {
      productId: product.id,
      productName: product.name,
      quantity: qty,
      unitPrice: product.price,
      gstRate,
      // Filled in inside the transaction, once the coupon discount (if any) is known.
      gstAmount: 0,
    };
  });
  return { itemRows, taxLines, subtotal };
}
