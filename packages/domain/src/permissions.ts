/**
 * Permission catalogue (SRS Appendix A, TDD §10.3). Roles are data (FR-ADM-03); this file only
 * seeds the default roles. The owner role always holds every permission.
 *
 * Keys named in TDD §6.2 are used verbatim. Rows of Appendix A that the TDD does not name
 * received the keys marked "derived" below.
 */
export const PERMISSIONS = {
  // POS
  'sale.create': 'Bán tại quầy', // Sell at counter
  'sale.hold': 'Giữ giỏ / gọi lại giỏ', // hold
  'sale.reprint': 'In lại', // reprint
  'sale.view_all': 'Xem đơn của thu ngân khác',
  'sale.discount': 'Giảm giá trong hạn mức', // derived: discount within role limit
  'sale.discount_unlimited': 'Giảm giá không giới hạn', // derived
  'sale.price_override': 'Sửa giá bán', // derived
  'return.create': 'Trả hàng trong hạn mức',
  'return.approve': 'Duyệt trả hàng',
  'sale.void_paid': 'Hủy đơn đã thanh toán',
  'shift.open': 'Mở ca',
  'shift.close': 'Đóng ca',
  'shift.cash_movement': 'Thu/chi tiền mặt trong ca',
  'shift.view_all': 'Xem lịch sử ca', // derived: FR-POS-22 managers see all shifts
  'einvoice.manage': 'Quản lý hóa đơn điện tử',
  'pos.offline.manage': 'Thiết bị POS và ngoại lệ đồng bộ', // derived: FR-POS-24/26 manager review
  // Catalogue and stock
  'catalog.view': 'Xem danh mục',
  'catalog.edit': 'Sửa danh mục và giá',
  'catalog.view_cost': 'Xem giá vốn', // derived
  'catalog.import': 'Nhập danh mục từ Excel',
  'data.import': 'Nhập dữ liệu',
  'inventory.view': 'Xem tồn kho',
  'inventory.adjust': 'Điều chỉnh tồn kho',
  'inventory.count': 'Kiểm kho',
  'inventory.count_approve': 'Duyệt kiểm kho và điều chỉnh lớn',
  'purchasing.manage': 'Nhập hàng, nhà cung cấp, đơn đặt NCC',
  'purchasing.payables': 'Công nợ và quyết toán ký gửi',
  // Orders (R2)
  'online.manage': 'Xử lý đơn online / mạng xã hội',
  'online.confirm_payment': 'Xác nhận chuyển khoản',
  'contact_task.manage': 'Danh sách cần liên hệ', // derived
  // Customers and promotions
  'customer.view': 'Xem khách hàng',
  'customer.manage': 'Tạo / sửa khách hàng',
  'customer.adjust_points': 'Điều chỉnh điểm',
  'customer.erase': 'Xóa dữ liệu khách hàng',
  'promotion.manage': 'Quản lý khuyến mãi',
  // Events (R3)
  'event.manage': 'Quản lý sự kiện, đăng ký',
  'event.checkin': 'Check-in, thu tiền vé',
  'event.refund': 'Hoàn tiền và chi phí sự kiện',
  // Library (R4)
  'library.manage': 'Danh mục thư viện',
  'library.lend': 'Thành viên, mượn, trả',
  'library.fine_waive': 'Miễn phí phạt, hoàn cọc',
  // Website (R2)
  'web.content.view': 'Xem nội dung website',
  'web.content.edit': 'Sửa nội dung website',
  'web.content.publish': 'Đăng / lên lịch nội dung',
  // HR (R5)
  'hr.manage': 'Hồ sơ nhân viên, lịch làm, chấm công, thưởng',
  'hr.payroll': 'Tính và xem lương',
  // Reports and administration
  'report.view': 'Xem báo cáo vận hành',
  'report.profit': 'Xem lợi nhuận',
  'report.export': 'Xuất báo cáo',
  'audit.view': 'Xem nhật ký',
  'user.manage': 'Người dùng',
  'user.unlock': 'Mở khóa tài khoản nhân viên', // derived: FR-ADM-01 owner or manager unlock
  'role.manage': 'Phân quyền',
  'settings.manage': 'Cài đặt, sao lưu, tích hợp',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.hasOwn(PERMISSIONS, value);
}

export type RoleCode =
  | 'owner'
  | 'manager'
  | 'cashier'
  | 'warehouse'
  | 'online_staff'
  | 'event_coordinator'
  | 'librarian'
  | 'website_editor';

const managerExcluded: Permission[] = [
  'hr.payroll',
  'user.manage',
  'role.manage',
  'settings.manage',
];

/** Default role grants – SRS Appendix A columns. */
export const DEFAULT_ROLES: Record<RoleCode, { name: string; permissions: Permission[] }> = {
  owner: { name: 'Chủ cửa hàng', permissions: ALL_PERMISSIONS },
  manager: {
    name: 'Quản lý',
    permissions: ALL_PERMISSIONS.filter((p) => !managerExcluded.includes(p)),
  },
  cashier: {
    name: 'Thu ngân',
    permissions: [
      'sale.create',
      'sale.hold',
      'sale.reprint',
      'sale.discount',
      'return.create',
      'shift.open',
      'shift.close',
      'shift.cash_movement',
      'catalog.view',
      'inventory.view',
      'customer.view',
      'customer.manage',
      'event.checkin',
    ],
  },
  warehouse: {
    name: 'Thủ kho',
    permissions: [
      'catalog.view',
      'catalog.edit',
      'catalog.view_cost',
      'catalog.import',
      'data.import',
      'inventory.view',
      'inventory.adjust',
      'inventory.count',
      'purchasing.manage',
      'online.manage',
    ],
  },
  online_staff: {
    name: 'Nhân viên bán online',
    permissions: [
      'catalog.view',
      'inventory.view',
      'online.manage',
      'online.confirm_payment',
      'contact_task.manage',
      'customer.view',
      'customer.manage',
    ],
  },
  event_coordinator: {
    name: 'Điều phối sự kiện',
    permissions: [
      'catalog.view',
      'contact_task.manage',
      'customer.view',
      'customer.manage',
      'event.manage',
      'event.checkin',
    ],
  },
  librarian: {
    name: 'Thủ thư',
    permissions: [
      'catalog.view',
      'contact_task.manage',
      'customer.view',
      'customer.manage',
      'library.manage',
      'library.lend',
    ],
  },
  website_editor: {
    name: 'Biên tập website',
    permissions: ['catalog.view', 'web.content.view', 'web.content.edit', 'web.content.publish'],
  },
};
