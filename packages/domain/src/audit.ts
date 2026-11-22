/**
 * Kinds of action in the audit log (FR-ADM-05, Design §12.11), shared by the server filter and the
 * staff app. Each group lists action prefixes; an action belongs to the first group that matches, so
 * exports (`customer.export`) land in `export` before `customers`.
 */
export const AUDIT_GROUPS = [
  { key: 'export', label: 'Xuất dữ liệu', prefixes: ['report.export', 'customer.export', 'catalog.export'] },
  { key: 'login', label: 'Đăng nhập', prefixes: ['auth.login', 'auth.lockout'] },
  { key: 'sales', label: 'Bán hàng & đơn', prefixes: ['sale.', 'order.', 'preorder.', 'promotion.', 'points.', 'cash.', 'shift.'] },
  { key: 'catalog', label: 'Sản phẩm & giá', prefixes: ['item.', 'variant.', 'price.', 'bundle.', 'category.', 'catalog.', 'import.', 'master_data.'] },
  { key: 'stock', label: 'Kho & nhập hàng', prefixes: ['stock_in.', 'stock_count.', 'stock.', 'consignment', 'supplier'] },
  { key: 'customers', label: 'Khách hàng', prefixes: ['customer.'] },
  { key: 'library', label: 'Thư viện', prefixes: ['library.'] },
  { key: 'staff', label: 'Nhân viên & phân quyền', prefixes: ['user.', 'role.', 'auth.', 'setup.'] },
  { key: 'system', label: 'Cài đặt & thiết bị', prefixes: ['setting.', 'register.', 'pos_device.', 'pos_sync.', 'backup.', 'channel.'] },
] as const;

export type AuditGroup = (typeof AUDIT_GROUPS)[number]['key'];

/** The group of an action, or null when none matches. */
export function auditGroup(action: string): AuditGroup | null {
  return AUDIT_GROUPS.find((g) => g.prefixes.some((p) => action.startsWith(p)))?.key ?? null;
}
