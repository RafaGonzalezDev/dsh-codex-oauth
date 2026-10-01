/** Public, token-free Host/Client contracts. */
export interface AccountView {
  label: string;
  email?: string;
}

export interface ModelView {
  id: string;
  name: string;
  available: boolean;
  inputModalities: Array<'text' | 'image'>;
  warning?: string;
}

/** Pi publishes metadata, not account-specific inference authorization. */
export interface CatalogInfo {
  source: 'pi';
  sourceUrl: string;
  loadedFrom: 'bundled' | 'cache' | 'remote';
  revision: string;
  lastCheckedAt?: number;
  lastUpdatedAt?: number;
  refreshing: boolean;
  warning?: string;
}

export interface ConnectionStatus {
  state: 'disconnected' | 'authorizing' | 'connected' | 'needs-reconnect';
  profile: string;
  account?: AccountView;
  models: ModelView[];
  /** Selectability in the local catalog, not a verified account entitlement. */
  preferredModelAvailable: boolean;
  catalog?: CatalogInfo;
  warning?: string;
  errorCode?: string;
}

export interface AuthorizationOptions {
  mode: 'connect' | 'change-account';
  reconsent?: boolean;
}

export type AuthorizationEvent =
  | { type: 'notice'; message: string; url?: string }
  | { type: 'status'; status: ConnectionStatus }
  | { type: 'error'; code: string; message: string }
  | { type: 'settled'; outcome: 'authorized' | 'cancelled' | 'failed' };

export interface DisconnectResult {
  status: ConnectionStatus;
  revocationConfirmed: boolean;
}
