import { GeocodingProvider, GeocodeResponse, GeocodeRequest } from '../types/geocoding';
import axios from 'axios';

export class GoogleProvider implements GeocodingProvider {
  private apiKey: string;
  private referer: string;

  constructor() {
    this.apiKey = process.env.GOOGLE_MAPS_API_KEY!;
    // Referer header for API key HTTP referrer restrictions
    this.referer = process.env.GOOGLE_API_REFERER || process.env.NEXT_PUBLIC_APP_URL || 'https://api.example.com';
  }

  name = 'google';

  async geocode(address: string, options?: GeocodeRequest['options']): Promise<GeocodeResponse> {
    try {
      const response = await axios.get(
        'https://maps.googleapis.com/maps/api/geocode/json',
        {
          params: {
            address,
            key: this.apiKey,
            language: options?.language,
            bounds: options?.bounds ? `${options.bounds.southwest.lat},${options.bounds.southwest.lng}|${options.bounds.northeast.lat},${options.bounds.northeast.lng}` : undefined,
            components: options?.country ? `country:${options.country}` : undefined
          },
          headers: {
            'Referer': this.referer
          }
        }
      );

      if (response.data.status !== 'OK') {
        throw new Error(`Geocoding failed: ${response.data.status}`);
      }

      return {
        success: true,
        provider: this.name,
        results: response.data.results.map(this.transformResult)
      };
    } catch (error: unknown) {
      return {
        success: false,
        provider: this.name,
        results: [],
        error: {
          code: (error as { response?: { status?: number } }).response?.status?.toString() || 'UNKNOWN',
          message: (error as { message?: string }).message || 'Unknown error occurred'
        }
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.geocode('1600 Amphitheatre Parkway, Mountain View, CA');
      return response.success;
    } catch {
      return false;
    }
  }

  getRateLimit() {
    return {
      requests: 50,
      period: 1000 // 1 second
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private transformResult(result: any) {
    return {
      latitude: result.geometry.location.lat,
      longitude: result.geometry.location.lng,
      formattedAddress: result.formatted_address,
      confidence: 1,
      components: {
        street: result.address_components.find((c: { types: string[] }) => c.types.includes('route'))?.long_name,
        city: result.address_components.find((c: { types: string[] }) => c.types.includes('locality'))?.long_name,
        state: result.address_components.find((c: { types: string[] }) => c.types.includes('administrative_area_level_1'))?.long_name,
        country: result.address_components.find((c: { types: string[] }) => c.types.includes('country'))?.long_name,
        postalCode: result.address_components.find((c: { types: string[] }) => c.types.includes('postal_code'))?.long_name
      },
      raw: result
    };
  }
} 