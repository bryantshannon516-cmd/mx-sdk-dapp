/**
 * Unit tests for the WalletConnect session localStorage helpers.
 */

import { SessionTypes } from '@multiversx/sdk-wallet-connect-provider/out';
import { WALLET_CONNECT_SESSION_STORAGE_KEY } from 'constants/walletConnectSession.constants';
import {
  persistWalletConnectSession,
  getPersistedWalletConnectSession,
  clearPersistedWalletConnectSession
} from '../walletConnectSession';

const MOCK_SESSION: SessionTypes.Struct = {
  topic: 'test-topic-xyz',
  namespaces: {},
  requiredNamespaces: {},
  optionalNamespaces: {},
  pairingTopic: '',
  relay: { protocol: 'irn' },
  expiry: 9999999999,
  acknowledged: true,
  controller: '',
  self: {
    publicKey: '',
    metadata: { name: '', description: '', url: '', icons: [] }
  },
  peer: {
    publicKey: '',
    metadata: { name: '', description: '', url: '', icons: [] }
  }
} as unknown as SessionTypes.Struct;

beforeEach(() => {
  localStorage.clear();
});

describe('persistWalletConnectSession', () => {
  it('serialises the session and writes it to localStorage', () => {
    persistWalletConnectSession(MOCK_SESSION);

    const raw = localStorage.getItem(WALLET_CONNECT_SESSION_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).topic).toBe('test-topic-xyz');
  });

  it('overwrites a previously stored session', () => {
    persistWalletConnectSession(MOCK_SESSION);
    persistWalletConnectSession({ ...MOCK_SESSION, topic: 'updated-topic' });

    const raw = localStorage.getItem(WALLET_CONNECT_SESSION_STORAGE_KEY);
    expect(JSON.parse(raw!).topic).toBe('updated-topic');
  });

  it('silently ignores localStorage errors', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    expect(() => persistWalletConnectSession(MOCK_SESSION)).not.toThrow();

    jest.restoreAllMocks();
  });
});

describe('getPersistedWalletConnectSession', () => {
  it('returns null when nothing is stored', () => {
    expect(getPersistedWalletConnectSession()).toBeNull();
  });

  it('deserialises and returns the stored session', () => {
    persistWalletConnectSession(MOCK_SESSION);
    const result = getPersistedWalletConnectSession();

    expect(result).not.toBeNull();
    expect(result?.topic).toBe('test-topic-xyz');
  });

  it('returns null when the stored value is invalid JSON', () => {
    localStorage.setItem(WALLET_CONNECT_SESSION_STORAGE_KEY, '{invalid json}');

    expect(getPersistedWalletConnectSession()).toBeNull();
  });

  it('silently ignores localStorage errors and returns null', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    expect(getPersistedWalletConnectSession()).toBeNull();

    jest.restoreAllMocks();
  });
});

describe('clearPersistedWalletConnectSession', () => {
  it('removes the session from localStorage', () => {
    persistWalletConnectSession(MOCK_SESSION);
    expect(
      localStorage.getItem(WALLET_CONNECT_SESSION_STORAGE_KEY)
    ).not.toBeNull();

    clearPersistedWalletConnectSession();

    expect(
      localStorage.getItem(WALLET_CONNECT_SESSION_STORAGE_KEY)
    ).toBeNull();
  });

  it('does not throw when there is nothing to remove', () => {
    expect(() => clearPersistedWalletConnectSession()).not.toThrow();
  });

  it('silently ignores localStorage errors', () => {
    jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    expect(() => clearPersistedWalletConnectSession()).not.toThrow();

    jest.restoreAllMocks();
  });
});
