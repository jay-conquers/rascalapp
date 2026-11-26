export interface KickDeskState {
  loggedIn: boolean;
  account: string | null;
  userId: string | null;
  clientId: string;
  clientSecretSet: boolean;
  relaySecretSet: boolean;
  scopes: string[];
  status: string;
}
