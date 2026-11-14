import { useQuery } from '@tanstack/react-query';
import { get } from './api';

/** An open shift at one of the registers: cash taken or paid out off the POS screen goes into it (FR-POS-13/14, FR-ORD-14). */
export function useOpenShift() {
  return useQuery({
    queryKey: ['open-shift'],
    queryFn: async () => {
      const regs = await get<{ items: { id: string; code: string }[] }>('/api/v1/pos/registers');
      for (const r of regs.items) {
        const s = await get<{ shift: { id: string; shiftNo: number } | null }>('/api/v1/pos/shifts/current', { register: r.id });
        if (s.shift) return { ...s.shift, registerCode: r.code };
      }
      return null;
    },
  });
}
