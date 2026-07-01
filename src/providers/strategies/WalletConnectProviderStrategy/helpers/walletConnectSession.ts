import { SessionTypes } from '@multiversx/sdk-wallet-connect-provider/out';
import { WALLET_CONNECT_SESSION_STORAGE_KEY } from 'constants/walletConnectSession.constants';

/**
 * Persists the active WalletConnect session to localStorage so that silent
 * reconnection can be attempted after a page refresh.
 */
export function persistWalletConnectSession(
  session: SessionTypes.Struct
): void {
  try {
    localStorage.setItem(
      WALLET_CONNECT_SESSION_STORAGE_KEY,
      JSON.stringify(session)
    );
  } catch {
    // localStorage may be unavailable in certain environments (e.g. SSR,
    // private-browsing quota exceeded).  Silently ignore.
  }
}

/**
 * Reads the previously persisted WalletConnect session from localStorage.
 * Returns `null` when no valid session is stored.
 */
export function getPersistedWalletConnectSession(): SessionTypes.Struct | null {
  try {
    const raw = localStorage.getItem(WALLET_CONNECT_SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as SessionTypes.Struct;
  } catch {
    return null;
  }
}

/**
 * Removes the persisted WalletConnect session entry from localStorage.
 * Call this whenever the session becomes stale or the user logs out.
 */
export function clearPersistedWalletConnectSession(): void {
  try {
    localStorage.removeItem(WALLET_CONNECT_SESSION_STORAGE_KEY);
  } catch {
    // Silently ignore.
  }
}
