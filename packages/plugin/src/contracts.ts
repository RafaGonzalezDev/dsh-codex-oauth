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

export interface ConnectionStatus {
  state: 'disconnected' | 'authorizing' | 'connected' | 'needs-reconnect';
  profile: string;
  account?: AccountView;
  models: ModelView[];
  preferredModelAvailable: boolean;
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
