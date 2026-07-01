import {
  SessionEventTypes,
  SessionTypes,
  OptionalOperation
} from '@multiversx/sdk-wallet-connect-provider/out';
import { providerLabels } from 'constants/providerFactory.constants';
import { fallbackWalletConnectConfigurations } from 'constants/walletConnect.constants';
import { Message, Transaction } from 'lib/sdkCore';
import { IDAppProviderAccount } from 'lib/sdkDappUtils';
import { WalletConnectStateManager } from 'managers/internal/WalletConnectStateManager/WalletConnectStateManager';
import { getIsLoggedIn } from 'methods/account/getIsLoggedIn';
import { SignTransactionsOptionsType } from 'providers/DappProvider/helpers/signTransactions/signTransactionsWithProvider';
import {
  ProviderTypeEnum,
  ProviderType
} from 'providers/types/providerFactory.types';
import { logoutAction } from 'store/actions/sharedActions/sharedActions';
import { nativeAuthConfigSelector } from 'store/selectors/configSelectors';
import { chainIdSelector } from 'store/selectors/networkSelectors';
import { getState } from 'store/store';
import { ProviderErrorsEnum } from 'types/provider.types';
import {
  WalletConnectOptionalMethodsEnum,
  WalletConnectV2Provider
} from 'utils/walletconnect/__sdkWalletconnectProvider';
import { WalletConnectV2Error, WalletConnectConfig } from './types';
import { BaseProviderStrategy } from '../BaseProviderStrategy/BaseProviderStrategy';
import { signMessage } from '../helpers/signMessage/signMessage';
import { guardTransactions } from '../helpers/signTransactions/helpers/guardTransactions/guardTransactions';
import {
  persistWalletConnectSession,
  getPersistedWalletConnectSession,
  clearPersistedWalletConnectSession
} from './helpers/walletConnectSession';

const dappMethods: string[] = [
  WalletConnectOptionalMethodsEnum.CANCEL_ACTION,
  WalletConnectOptionalMethodsEnum.SIGN_LOGIN_TOKEN
];

type WalletConnectProviderStrategyConfigType = WalletConnectConfig & {
  anchor?: HTMLElement;
};

export class WalletConnectProviderStrategy extends BaseProviderStrategy {
  private provider: WalletConnectV2Provider | null = null;
  private readonly config: WalletConnectProviderStrategyConfigType;
  private methods: string[] = [];
  private _approval: (() => Promise<SessionTypes.Struct>) | null = null;
  protected cancelActionAbortController: AbortController | null = null;

  /**
   * Indicates that a silent reconnect attempt is in progress.  Exposed so
   * the `useGetIsWalletConnectReconnecting` hook can surface it to the UI.
   */
  public isReconnecting = false;

  constructor(config: WalletConnectProviderStrategyConfigType) {
    super();
    this.config = config;
  }

  async init(): Promise<boolean> {
    try {
      if (this.provider?.isInitialized()) {
        return true;
      }

      // ── Silent-reconnect path ──────────────────────────────────────────────
      const persisted = getPersistedWalletConnectSession();
      if (persisted) {
        const reconnected = await this.tryReconnectFromSession(persisted);
        if (reconnected) {
          return true;
        }
        // Session was stale – clear it and fall through to a fresh pairing.
        clearPersistedWalletConnectSession();
      }
      // ── New-pairing path ───────────────────────────────────────────────────

      await this.initializeProvider();
    } catch {
      return false;
    }

    return true;
  }

  logout(): Promise<boolean> {
    clearPersistedWalletConnectSession();

    if (!this.provider) {
      throw new Error(ProviderErrorsEnum.notInitialized);
    }

    return this.provider.logout();
  }

  getType(): ProviderType {
    return ProviderTypeEnum.walletConnect;
  }

  getAddress(): Promise<string | undefined> {
    if (!this.provider) {
      throw new Error(ProviderErrorsEnum.notInitialized);
    }

    return Promise.resolve(this.provider.getAddress());
  }

  setAccount(account: IDAppProviderAccount): void {
    return this.provider?.setAccount(account);
  }

  isInitialized(): boolean {
    if (!this.provider) {
      throw new Error(ProviderErrorsEnum.notInitialized);
    }

    return this.provider.isInitialized();
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Attempts to silently reconnect using a previously persisted session.
   *
   * The flow is:
   * 1. Build a fresh WalletConnectV2Provider instance (same as normal init).
   * 2. Call `init()` on the underlying provider so it restores the existing
   *    WalletConnect session from the relay / internal storage.
   * 3. Check whether the provider ended up with the same topic as the
   *    persisted session – if yes, the session is still live.
   *
   * @returns `true` when reconnection succeeds, `false` otherwise.
   */
  private async tryReconnectFromSession(
    session: SessionTypes.Struct
  ): Promise<boolean> {
    this.isReconnecting = true;
    try {
      const { walletConnectProvider, dappMethods: dAppMethods } =
        await this.createWalletConnectProvider(this.config);

      this.provider = walletConnectProvider;
      this.methods = dAppMethods;

      // The WalletConnect SDK restores sessions from its own storage during
      // `init()`.  Verify the expected topic is still alive.
      const address = this.provider.getAddress();
      const topicMatches =
        (this.provider as unknown as { session?: { topic?: string } })
          .session?.topic === session.topic;

      if (address && topicMatches) {
        return true;
      }

      return false;
    } catch {
      return false;
    } finally {
      this.isReconnecting = false;
    }
  }

  private async initializeProvider() {
    await this.initWalletConnectManager();

    if (!this.config) {
      throw new Error(WalletConnectV2Error.invalidConfig);
    }

    const { walletConnectProvider, dappMethods: dAppMethods } =
      await this.createWalletConnectProvider(this.config);

    this.provider = walletConnectProvider;
    this.methods = dAppMethods;

    const { uri = '', approval } = await this.provider.connect({
      methods: this.methods
    });

    const walletConnectDeepLink =
      this.config.walletConnectDeepLink ??
      fallbackWalletConnectConfigurations.walletConnectDeepLink;

    this._approval = approval;
    const walletConnectManager = WalletConnectStateManager.getInstance();
    walletConnectManager.updateData({
      wcURI: uri,
      walletConnectDeepLink: `${walletConnectDeepLink}?wallet-connect=${encodeURIComponent(uri)}`
    });
  }

  private async initWalletConnectManager() {
    const shouldInitiateLogin = !getIsLoggedIn();

    if (!shouldInitiateLogin) {
      return;
    }

    const walletConnectManager = WalletConnectStateManager.getInstance();
    await walletConnectManager.init(this.config?.anchor);
  }

  private async createWalletConnectProvider(config: WalletConnectConfig) {
    const isLoggedIn = getIsLoggedIn();
    const chainId = chainIdSelector(getState());
    const nativeAuthConfig = nativeAuthConfigSelector(getState());

    if (nativeAuthConfig) {
      dappMethods.push(WalletConnectOptionalMethodsEnum.SIGN_NATIVE_AUTH_TOKEN);
    }

    if (!config?.walletConnectV2ProjectId) {
      throw new Error(WalletConnectV2Error.invalidConfig);
    }

    const handleOnLogin = () => {};

    const handleOnLogout = () => {
      clearPersistedWalletConnectSession();
      logoutAction();
    };

    const handleOnEvent = (_event: SessionEventTypes['event']) => {};

    const providerHandlers = {
      onClientLogin: handleOnLogin,
      onClientLogout: handleOnLogout,
      onClientEvent: handleOnEvent
    };

    try {
      const {
        walletConnectV2ProjectId,
        walletConnectV2Options = {},
        walletConnectV2RelayAddress = ''
      } = config;
      const walletConnectProvider = new WalletConnectV2Provider(
        providerHandlers,
        chainId,
        walletConnectV2RelayAddress,
        walletConnectV2ProjectId,
        walletConnectV2Options
      );

      await walletConnectProvider.init();

      return { walletConnectProvider, dappMethods };
    } catch (err) {
      console.error(WalletConnectV2Error.connectError, err);

      if (isLoggedIn) {
        await this.logout();
      }

      throw err;
    }
  }

  async login(options?: { token?: string }): Promise<{
    address: string;
    signature: string;
  }> {
    if (!this.provider) {
      throw new Error(
        'Provider is not initialized. Call createProvider first.'
      );
    }

    const reconnect = async (): Promise<{
      address: string;
      signature: string;
    }> => {
      if (!this.provider) {
        throw new Error(ProviderErrorsEnum.notInitialized);
      }

      try {
        await this.provider.init();
        const walletConnectManager = WalletConnectStateManager.getInstance();

        const { uri = '', approval: wcApproval } = await this.provider.connect({
          methods: this.methods
        });

        const walletConnectDeepLink =
          this.config.walletConnectDeepLink ??
          fallbackWalletConnectConfigurations.walletConnectDeepLink;

        walletConnectManager.updateData({
          wcURI: uri,
          walletConnectDeepLink: `${walletConnectDeepLink}?wallet-connect=${encodeURIComponent(uri)}`
        });

        const providerInfo = await this.provider.login({
          approval: wcApproval,
          token: options?.token
        });

        const { address = '', signature = '' } = providerInfo ?? {};

        // Persist the newly established session.
        const rawSession = (
          this.provider as unknown as { session?: SessionTypes.Struct }
        ).session;
        if (rawSession) {
          persistWalletConnectSession(rawSession);
        }

        walletConnectManager.handleClose({ isLoginFinished: Boolean(address) });
        return { address, signature };
      } catch {
        return await reconnect();
      }
    };

    if (!this._approval) {
      throw new Error('Approval or login is not initialized');
    }

    try {
      const providerData = await this.provider.login({
        approval: this._approval.bind(this),
        token: options?.token
      });

      const { address = '', signature = '' } = providerData ?? {};

      // Persist the newly established session.
      const rawSession = (
        this.provider as unknown as { session?: SessionTypes.Struct }
      ).session;
      if (rawSession) {
        persistWalletConnectSession(rawSession);
      }

      const walletConnectManager = WalletConnectStateManager.getInstance();
      walletConnectManager.handleClose({ isLoginFinished: Boolean(address) });
      return { address, signature };
    } catch (error) {
      console.error(WalletConnectV2Error.userRejected, error);
      return await reconnect();
    }
  }

  signTransactions = async (
    transactions: Transaction[],
    _options?: SignTransactionsOptionsType
  ) => {
    if (!this.provider) {
      throw new Error(ProviderErrorsEnum.notInitialized);
    }

    const { manager, onClose } = await this.initSignState();

    this.cancelActionAbortController = new AbortController();
    const signal = this.cancelActionAbortController.signal;

    try {
      const abortPromise = new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => {
          reject(new Error('cancelled by user'));
        });
      });

      const signedTransactions: Transaction[] = await Promise.race([
        this.provider.signTransactions(transactions),
        abortPromise
      ]);

      const optionallyGuardedTransactions =
        await guardTransactions(signedTransactions);

      return optionallyGuardedTransactions;
    } catch (error) {
      await onClose({ shouldCancelAction: true });
      throw error;
    } finally {
      manager?.closeUI();
    }
  };

  cancelAction = async () => {
    this.sendCustomRequest({
      method: WalletConnectOptionalMethodsEnum.CANCEL_ACTION,
      action: OptionalOperation.CANCEL_ACTION
    });

    this.cancelActionAbortController?.abort();
  };

  signMessage = async (message: Message) => {
    if (!this.provider) {
      throw new Error(ProviderErrorsEnum.notInitialized);
    }

    this.cancelActionAbortController = new AbortController();
    const signal = this.cancelActionAbortController.signal;

    const abortPromise = new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => {
        reject(new Error('cancelled by user'));
      });
    });

    const signedMessage = await Promise.race([
      signMessage({
        message,
        handleSignMessage: this.provider.signMessage.bind(this.provider),
        cancelAction: this.cancelAction,
        providerType: providerLabels.extension
      }),
      abortPromise
    ]);

    return signedMessage;
  };

  private async sendCustomRequest({
    action,
    method
  }: {
    action: OptionalOperation;
    method: WalletConnectOptionalMethodsEnum;
  }) {
    if (!this.provider) {
      throw new Error(ProviderErrorsEnum.notInitialized);
    }

    try {
      await this.provider.sendCustomRequest?.({
        request: {
          method,
          params: { action }
        }
      });
    } catch (error) {
      console.error(WalletConnectV2Error.actionError, error);
    }
  }
}
