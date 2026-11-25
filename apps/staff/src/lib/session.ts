import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, get, post } from './api';

/** Signed-in staff member, re-read from the server (permissions change take effect at once). */
export interface Me {
  id: string;
  username: string;
  displayName: string;
  roleId: string;
  isOwner: boolean;
  permissions: string[];
  locked: boolean;
  mustChangePassword: boolean;
  /** Whether a quick PIN is set (user menu, lock screen; FR-ADM-01). */
  hasPin?: boolean;
}

const ME_KEY = 'bms.me';
const isNetwork = (e: unknown) => e instanceof ApiError && e.status === 0;

/** Last signed-in staff member, so an open POS keeps working when the network drops (FR-POS-23). */
function cachedMe(): Me | null {
  try {
    return JSON.parse(localStorage.getItem(ME_KEY) ?? 'null') as Me | null;
  } catch {
    return null;
  }
}

export function useSetupStatus() {
  return useQuery({
    queryKey: ['setup'],
    queryFn: () => get<{ needsSetup: boolean }>('/api/v1/setup').catch((e) => (isNetwork(e) && cachedMe() ? { needsSetup: false } : Promise.reject(e))),
    staleTime: Infinity,
  });
}

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        const me = await get<Me>('/api/v1/me');
        localStorage.setItem(ME_KEY, JSON.stringify(me));
        return me;
      } catch (e) {
        if (isNetwork(e) && cachedMe()) return cachedMe();
        if (e instanceof ApiError && (e.status === 401 || e.code === 'password_change_required')) {
          localStorage.removeItem(ME_KEY);
          return null;
        }
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

export function can(me: Me | null | undefined, permission: string): boolean {
  return !!me && (me.isOwner || me.permissions.includes(permission));
}

export function useSignOut() {
  const qc = useQueryClient();
  return async () => {
    await post('/api/v1/auth/logout').catch(() => undefined);
    localStorage.removeItem(ME_KEY);
    qc.clear();
    window.location.href = '/login';
  };
}
