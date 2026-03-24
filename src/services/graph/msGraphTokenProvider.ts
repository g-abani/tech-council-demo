interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export interface MSGraphCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

/**
 * OAuth2 client credentials token provider for Microsoft Entra ID (Azure AD).
 * Acquires tokens scoped to Microsoft Graph using the client_credentials grant.
 */
export class MSGraphTokenProvider {
  private static readonly TOKEN_DRIFT_MS = 60_000;
  private static readonly MAX_ATTEMPTS = 3;

  private readonly tenantId: string;
  private readonly clientId: string;
  private readonly clientSecret: string;

  private accessToken: string | null = null;
  private expiresAt: number | null = null;

  constructor(credentials: MSGraphCredentials) {
    this.tenantId = credentials.tenantId;
    this.clientId = credentials.clientId;
    this.clientSecret = credentials.clientSecret;
  }

  public async token(): Promise<string> {
    if (
      this.accessToken &&
      this.expiresAt &&
      Date.now() < this.expiresAt - MSGraphTokenProvider.TOKEN_DRIFT_MS
    ) {
      return this.accessToken;
    }
    return this.acquireToken(1);
  }

  private async acquireToken(attempt: number): Promise<string> {
    if (attempt > MSGraphTokenProvider.MAX_ATTEMPTS) {
      throw new Error(
        `Failed to acquire MS Graph token after ${MSGraphTokenProvider.MAX_ATTEMPTS} attempts`
      );
    }

    const url = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: "https://graph.microsoft.com/.default",
    });

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(
          `[MSGraphTokenProvider] Token request failed (attempt ${attempt}): HTTP ${response.status} – ${text}`
        );
        return this.acquireToken(attempt + 1);
      }

      const json = (await response.json()) as TokenResponse;
      this.accessToken = json.access_token;
      this.expiresAt = Date.now() + json.expires_in * 1000;
      return this.accessToken;
    } catch (error) {
      console.warn(
        `[MSGraphTokenProvider] Attempt ${attempt} failed, retrying…`,
        error
      );
      return this.acquireToken(attempt + 1);
    }
  }
}

let _instance: MSGraphTokenProvider | null = null;

/**
 * Get or create the MS Graph token provider singleton.
 */
export function getMSGraphTokenProvider(
  credentials?: Partial<MSGraphCredentials>
): MSGraphTokenProvider {
  if (!_instance || credentials) {
    const resolved: MSGraphCredentials = {
      tenantId:
        credentials?.tenantId || process.env.MS_GRAPH_TENANT_ID || "",
      clientId:
        credentials?.clientId || process.env.MS_GRAPH_CLIENT_ID || "",
      clientSecret:
        credentials?.clientSecret || process.env.MS_GRAPH_CLIENT_SECRET || "",
    };

    if (!resolved.tenantId || !resolved.clientId || !resolved.clientSecret) {
      throw new Error(
        "MS Graph credentials not configured. Set MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, and MS_GRAPH_CLIENT_SECRET."
      );
    }

    _instance = new MSGraphTokenProvider(resolved);
  }
  return _instance;
}

export function clearMSGraphTokenProvider(): void {
  _instance = null;
}
