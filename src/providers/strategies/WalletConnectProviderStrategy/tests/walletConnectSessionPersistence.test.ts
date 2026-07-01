/**
 * Unit tests for WalletConnect session persistence and auto-reconnect.
 *
 * Covers:
 *  - Happy-path: persisted session allows silent reconnect without new QR code
 *  - Stale-session cleanup: failed reconnect clears localStorage and falls
 *    through to a fresh pairing flow
 *  - Session is persisted to localStorage after a successful login
 *  - Session is cleared from localStorage on logout
 *  - `isReconnecting` flag lifecycle
 */

import { SessionTypes } from '@multiversx/sdk-wallet-connect-provider/out';
import { account as storeAccount } from '__mocks__/data/storeData/account';
import { fallbackWalletConnectConfigurations } from 'constants/walletConnect.constants';
import { WALLET_CONNECT_SESSION_STORAGE_KEY } from 'constants/walletConnectSession.constants';
import { WalletConnectOptionalMethodsEnum } from 'utils/walletconnect/__sdkWalletconnectProvider';
import { WalletConnectProviderStrategy } from '../WalletConnectProviderStrategy';

// ── Mock the WalletConnect provider ─────────────────────────────────────────

const mockWalletConnectProvider = {
  init: jest.fn(),
  isInitialized: jest.fn(),
  connect: jest.fn(),
  login: jest.fn(),
  logout: jest.fn(),
  getAddress: jest.fn(),
  setAccount: jest.fn(),
  signTransactions: jest.fn(),
  signMessage: jest.fn(),
  sendCustomRequest: jest.fn(),
  session: undefined as SessionTypes.Struct | undefined
};

jest.mock('utils/walletconnect/__sdkWalletconnectProvider', () => {
  const actual = jest.requireActual(
    'utils/walletconnect/__sdkWalletconnectProvider'
  );
  return {
    ...actual,
    WalletConnectV2Provider: jest.fn(() => mockWalletConnectProvider)
  };
});

// ── Mock the WalletConnect state manager ────────────────────────────────────

const mockWalletConnectManager = {
  init: jest.fn(),
  updateData: jest.fn(),
  handleClose: jest.fn(),
  closeUI: jest.fn()
};

jest.mock(
  'managers/internal/WalletConnectStateManager/WalletConnectStateManager',
  () => ({
    WalletConnectStateManager: {
      getInstance: jest.fn(() => mockWalletConnectManager)
    }
  })
);

// ── Misc mocks (same as the main strategy test) ──────────────────────────────

jest.mock('methods/account/getIsLoggedIn', () => ({
  getIsLoggedIn: jest.fn()
}));

jest.mock('store/selectors/networkSelectors', () => ({
  chainIdSelector: jest.fn()
}));

jest.mock('store/selectors/configSelectors', () => ({
  nativeAuthConfigSelector: jest.fn(),
  providerSettingsSelector: jest.fn()
}));

jest.mock('store/store', () => ({
  getState: jest.fn()
}));

jest.mock('store/actions/sharedActions/sharedActions', () => ({
  logoutAction: jest.fn()
}));

jest.mock('methods/account/getAccount', () => ({
  getAccount: jest.fn()
}));

jest.mock('../../helpers', () => ({
  getPendingTransactionsHandlers: jest.fn()
}));

jest.mock('../../helpers/signMessage/signMessage', () => ({
  signMessage: jest.fn()
}));

// ── Typed mock helpers ───────────────────────────────────────────────────────

const { WalletConnectV2Provider: MockWCProvider } = jest.requireMock(
  'utils/walletconnect/__sdkWalletconnectProvider'
) as { WalletConnectV2Provider: jest.Mock };

const { getIsLoggedIn: mockGetIsLoggedIn } = jest.requireMock(
  'methods/account/getIsLoggedIn'
) as { getIsLoggedIn: jest.Mock };

const { chainIdSelector: mockChainIdSelector } = jest.requireMock(
  'store/selectors/networkSelectors'
) as { chainIdSelector: jest.Mock };

const {
  nativeAuthConfigSelector: mockNativeAuthConfigSelector
} = jest.requireMock('store/selectors/configSelectors') as {
  nativeAuthConfigSelector: jest.Mock;
};

const { getState: mockGetState } = jest.requireMock('store/store') as {
  getState: jest.Mock;
};

// ── localStorage helpers ─────────────────────────────────────────────────────

function setStoredSession(session: SessionTypes.Struct) {
  localStorage.setItem(
    WALLET_CONNECT_SESSION_STORAGE_KEY,
    JSON.stringify(session)
  );
}

function getStoredSession(): SessionTypes.Struct | null {
  const raw = localStorage.getItem(WALLET_CONNECT_SESSION_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as SessionTypes.Struct) : null;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const LIVE_SESSION: SessionTypes.Struct = {
  topic: 'live-topic-abc123',
  namespaces: {},
  requiredNamespaces: {},
  optionalNamespaces: {},
  pairingTopic: '',
  relay: { protocol: 'irn' },
  expiry: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  acknowledged: true,
  controller: '',
  self: { publicKey: '', metadata: { name: '', description: '', url: '', icons: [] } },
  peer: { publicKey: '', metadata: { name: '', description: '', url: '', icons: [] } }
} as unknown as SessionTypes.Struct;

const defaultConfig = { walletConnectV2ProjectId: 'project-id' };

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();

  // Default provider behaviour
  mockWalletConnectProvider.isInitialized.mockReturnValue(false);
  mockWalletConnectProvider.init.mockResolvedValue(undefined);
  mockWalletConnectProvider.connect.mockResolvedValue({
    uri: 'wc://uri',
    approval: jest.fn(async () => ({ topic: 'topic' }) as SessionTypes.Struct)
  });
  mockWalletConnectProvider.login.mockResolvedValue({
    address: storeAccount.address,
    signature: 'sig'
  });
  mockWalletConnectProvider.logout.mockResolvedValue(true);
  mockWalletConnectProvider.getAddress.mockReturnValue('');
  (mockWalletConnectProvider as { session?: SessionTypes.Struct }).session =
    undefined;

  // Store / selector defaults
  mockGetIsLoggedIn.mockReturnValue(false);
  mockChainIdSelector.mockReturnValue('D');
  mockNativeAuthConfigSelector.mockReturnValue(undefined);
  mockGetState.mockReturnValue({});
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('WalletConnect session persistence – happy path', () => {
  it('silently reconnects when a valid persisted session exists', async () => {
    // Arrange: store a session and make the provider report the same topic & address
    setStoredSession(LIVE_SESSION);
    mockWalletConnectProvider.getAddress.mockReturnValue(storeAccount.address);
    (mockWalletConnectProvider as { session?: SessionTypes.Struct }).session =
      LIVE_SESSION;

    const strategy = new WalletConnectProviderStrategy(defaultConfig);

    // Act
    const result = await strategy.init();

    // Assert: init succeeds
    expect(result).toBe(true);

    // The provider was initialised but NO new pairing QR was generated
    expect(mockWalletConnectProvider.connect).not.toHaveBeenCalled();
    expect(mockWalletConnectManager.updateData).not.toHaveBeenCalled();
  });

  it('sets isReconnecting to true during reconnect and resets it afterwards', async () => {
    setStoredSession(LIVE_SESSION);
    mockWalletConnectProvider.getAddress.mockReturnValue(storeAccount.address);
    (mockWalletConnectProvider as { session?: SessionTypes.Struct }).session =
      LIVE_SESSION;

    const strategy = new WalletConnectProviderStrategy(defaultConfig);

    // Capture value mid-flight by wrapping init
    let duringReconnect = false;
    const origInit = mockWalletConnectProvider.init.getMockImplementation();
    mockWalletConnectProvider.init.mockImplementation(async (...args: unknown[]) => {
      duringReconnect = strategy.isReconnecting;
      return origInit ? origInit(...args) : undefined;
    });

    expect(strategy.isReconnecting).toBe(false);
    await strategy.init();
    expect(duringReconnect).toBe(true);
    expect(strategy.isReconnecting).toBe(false);
  });

  it('persists session to localStorage after a successful login', async () => {
    const newSession: SessionTypes.Struct = {
      ...LIVE_SESSION,
      topic: 'new-login-topic'
    };
    // No persisted session → fresh pairing flow
    mockWalletConnectProvider.login.mockResolvedValue({
      address: storeAccount.address,
      signature: 'sig'
    });
    (mockWalletConnectProvider as { session?: SessionTypes.Struct }).session =
      newSession;

    const strategy = new WalletConnectProviderStrategy(defaultConfig);
    await strategy.init(); // fresh pairing

    await strategy.login({ token: 'abc' });

    const stored = getStoredSession();
    expect(stored).not.toBeNull();
    expect(stored?.topic).toBe('new-login-topic');
  });
});

describe('WalletConnect session persistence – stale session cleanup', () => {
  it('clears localStorage and falls through to a fresh pairing when reconnect fails', async () => {
    // Arrange: persisted session exists but provider has no matching address/topic
    setStoredSession(LIVE_SESSION);
    mockWalletConnectProvider.getAddress.mockReturnValue(''); // no address → reconnect fails
    (mockWalletConnectProvider as { session?: SessionTypes.Struct }).session =
      undefined; // topic mismatch

    const strategy = new WalletConnectProviderStrategy(defaultConfig);

    const result = await strategy.init();

    // Init still succeeds (new pairing was started)
    expect(result).toBe(true);

    // Stale session was removed from localStorage
    expect(getStoredSession()).toBeNull();

    // A fresh pairing was initiated
    expect(mockWalletConnectProvider.connect).toHaveBeenCalledTimes(1);
    expect(mockWalletConnectManager.updateData).toHaveBeenCalledWith(
      expect.objectContaining({
        wcURI: 'wc://uri',
        walletConnectDeepLink: expect.stringContaining(
          fallbackWalletConnectConfigurations.walletConnectDeepLink
        )
      })
    );
  });

  it('clears localStorage when the underlying provider init throws during reconnect', async () => {
    setStoredSession(LIVE_SESSION);
    // Make `init()` throw only on the first call (reconnect attempt).
    mockWalletConnectProvider.init
      .mockRejectedValueOnce(new Error('relay unavailable'))
      .mockResolvedValue(undefined);

    const strategy = new WalletConnectProviderStrategy(defaultConfig);
    const result = await strategy.init();

    // Still succeeds via new-pairing fallback
    expect(result).toBe(true);
    expect(getStoredSession()).toBeNull();
  });

  it('does not attempt reconnect when no session is stored', async () => {
    // localStorage is empty by default in beforeEach
    const strategy = new WalletConnectProviderStrategy(defaultConfig);
    await strategy.init();

    // connect() is called exactly once for the new pairing
    expect(mockWalletConnectProvider.connect).toHaveBeenCalledTimes(1);
  });
});

describe('WalletConnect session persistence – logout', () => {
  it('clears the persisted session when logout is called', async () => {
    setStoredSession(LIVE_SESSION);
    mockWalletConnectProvider.getAddress.mockReturnValue(storeAccount.address);
    (mockWalletConnectProvider as { session?: SessionTypes.Struct }).session =
      LIVE_SESSION;

    const strategy = new WalletConnectProviderStrategy(defaultConfig);
    await strategy.init(); // reconnects silently

    await strategy.logout();

    expect(getStoredSession()).toBeNull();
    expect(mockWalletConnectProvider.logout).toHaveBeenCalled();
  });
});

describe('WalletConnect session persistence – isReconnecting flag', () => {
  it('starts as false before init is called', () => {
    const strategy = new WalletConnectProviderStrategy(defaultConfig);
    expect(strategy.isReconnecting).toBe(false);
  });

  it('is false when no persisted session exists (no reconnect is attempted)', async () => {
    const strategy = new WalletConnectProviderStrategy(defaultConfig);
    const initPromise = strategy.init();
    // At the synchronous tick before await resolves there is no reconnect
    expect(strategy.isReconnecting).toBe(false);
    await initPromise;
    expect(strategy.isReconnecting).toBe(false);
  });
});

describe('WalletConnect session persistence – localStorage unavailability', () => {
  it('handles localStorage.getItem throwing gracefully', async () => {
    jest
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementationOnce(() => {
        throw new Error('storage quota exceeded');
      });

    const strategy = new WalletConnectProviderStrategy(defaultConfig);
    // Should not throw; should fall through to new-pairing flow
    const result = await strategy.init();
    expect(result).toBe(true);

    jest.restoreAllMocks();
  });

  it('handles localStorage.setItem throwing during persist gracefully', async () => {
    jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementationOnce(() => {
        throw new Error('storage quota exceeded');
      });

    const newSession: SessionTypes.Struct = {
      ...LIVE_SESSION,
      topic: 'quota-topic'
    };
    mockWalletConnectProvider.login.mockResolvedValue({
      address: storeAccount.address,
      signature: 'sig'
    });
    (mockWalletConnectProvider as { session?: SessionTypes.Struct }).session =
      newSession;

    const strategy = new WalletConnectProviderStrategy(defaultConfig);
    await strategy.init();

    // Should not throw; just doesn't persist
    await expect(strategy.login()).resolves.toEqual(
      expect.objectContaining({ address: storeAccount.address })
    );

    jest.restoreAllMocks();
  });
});
