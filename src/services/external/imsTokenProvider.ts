
interface IMSTokenResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }
  
  export class IMSTokenProvider {
    private static readonly MAX_ATTEMPTS = 3;
    private static readonly TOKEN_MAX_TIME_DRIFT = 60000; // 60 seconds
  
    private accessToken: string | null = null;
    private clientCode: string;
    private clientId: string;
    private clientSecret: string;
    private expire: number | null = null;
    private imsEnv: string;
    private refreshToken: string | null = null;
  
    constructor(imsEnv: string, clientId: string, clientSecret: string, clientCode: string) {
      this.imsEnv = imsEnv;
      this.clientId = clientId;
      this.clientSecret = clientSecret;
      this.clientCode = clientCode;
    }
  
    public getClientId(): string {
      return this.clientId;
    }
  
    public getImsEnv(): string {
      return this.imsEnv;
    }
  
    public async token(): Promise<string> {
      try {
        if (this.expire === null) {
          return await this.issueAccessToken(1);
        }
  
        const now = Date.now();
        if (now > this.expire - IMSTokenProvider.TOKEN_MAX_TIME_DRIFT) {
          return await this.refreshAccessToken(1);
        }
  
        return this.accessToken!;
      } catch (error) {
        throw new Error(`Unable to get IMS access token: ${error}`);
      }
    }
  
    private async executeTokenRequest(attempt: number, url: string, body: URLSearchParams, isRefresh: boolean = false): Promise<string> {
      if (attempt > IMSTokenProvider.MAX_ATTEMPTS) {
        throw new Error(`All ${IMSTokenProvider.MAX_ATTEMPTS} attempts to get an IMS token expired`);
      }
  
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        });
  
       // const debugId = response.headers.get('X-DEBUG-ID') || 'null';
        const statusCode = response.status;
        const responseText = await response.text();
  
        if (statusCode !== 200) {
          // Retry with the same operation type
          if (attempt < IMSTokenProvider.MAX_ATTEMPTS) {
            return isRefresh 
              ? await this.refreshAccessToken(attempt + 1)
              : await this.issueAccessToken(attempt + 1);
          } else {
            throw new Error(`HTTP ${statusCode}: ${responseText}`);
          }
        }
  
        return this.tokenFromResponse(responseText);
      } catch (error) {
        if (attempt < IMSTokenProvider.MAX_ATTEMPTS) {
          console.warn(`Attempt ${attempt} failed, retrying...`, error);
          // Retry with the same operation type
          return isRefresh 
            ? await this.refreshAccessToken(attempt + 1)
            : await this.issueAccessToken(attempt + 1);
        }
        throw error;
      }
    }
  
    private async issueAccessToken(attempt: number): Promise<string> {
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code: this.clientCode,
      });
  
      const url = `https://${this.imsEnv}.adobelogin.com/ims/token/v1`;
      
      return await this.executeTokenRequest(attempt, url, params, false);
    }
  
    private async refreshAccessToken(attempt: number): Promise<string> {
      if (!this.refreshToken) {
        throw new Error('No refresh token available');
      }
  
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
      });
  
      const url = `https://${this.imsEnv}.adobelogin.com/ims/token/v1`;
      
      return await this.executeTokenRequest(attempt, url, params, true);
    }
  
    private tokenFromResponse(responseText: string): string {
      try {
        const json: IMSTokenResponse = JSON.parse(responseText);
        
        this.accessToken = json.access_token;
        this.refreshToken = json.refresh_token;
        this.expire = Date.now() + (json.expires_in * 1000); // Convert to milliseconds
        
        return this.accessToken;
      } catch (error) {
        throw new Error(`Failed to parse token response: ${error}`);
      }
    }
  }
  

  // Store multiple token providers keyed by clientId
  const _imsTokenProviders = new Map<string, IMSTokenProvider>();

  export interface IMSCredentials {
    imsEnv?: string;
    clientId: string;
    clientSecret: string;
    clientCode: string;
  }

  /**
   * Get or create an IMS token provider
   * @param credentials - Optional custom credentials. If not provided, uses environment variables
   * @returns IMSTokenProvider instance
   */
  export function getIMSTokenProvider(credentials?: IMSCredentials): IMSTokenProvider {
    // Use provided credentials or fall back to environment variables
    const imsEnv = credentials?.imsEnv || process.env.IMS_ENV || 'ims-na1';
    const clientId = credentials?.clientId || process.env.IMS_CLIENT_ID || '';
    const clientSecret = credentials?.clientSecret || process.env.IMS_CLIENT_SECRET || '';
    const clientCode = credentials?.clientCode || process.env.IMS_CLIENT_CODE || '';

    if (!clientId || !clientSecret || !clientCode) {
      console.warn(' IMS credentials not configured, using mock provider');
      // Return mock provider
      return {
        async token() { return '<mock-ims-token>'; },
        getClientId() { return 'mock-client'; },
        getImsEnv() { return 'mock-env'; }
      } as IMSTokenProvider;
    }

    // Check if we already have a provider for this clientId
    const existingProvider = _imsTokenProviders.get(clientId);
    if (existingProvider) {
      return existingProvider;
    }

    // Create new provider
    const newProvider = new IMSTokenProvider(imsEnv, clientId, clientSecret, clientCode);
    _imsTokenProviders.set(clientId, newProvider);
    
    return newProvider;
  }

  /**
   * Clear all cached token providers (useful for testing)
   */
  export function clearIMSTokenProviders(): void {
    _imsTokenProviders.clear();
  }