export interface GeocodeRequest {
  address: string;
  provider?: string;
  options?: {
    country?: string;
    language?: string;
    bounds?: {
      northeast: { lat: number; lng: number };
      southwest: { lat: number; lng: number };
    };
  };
}

export interface GeocodeResponse {
  success: boolean;
  provider: string;
  results: {
    latitude: number;
    longitude: number;
    formattedAddress: string;
    confidence: number;
    components: {
      street?: string;
      city?: string;
      state?: string;
      country?: string;
      postalCode?: string;
    };
    raw?: unknown;
  }[];
  error?: {
    code: string;
    message: string;
  };
}

export interface GeocodingProvider {
  name: string;
  geocode(address: string, options?: unknown): Promise<GeocodeResponse>;
  isAvailable(): Promise<boolean>;
  getRateLimit(): {
    requests: number;
    period: number;
  };
} 