import { GeocodingProvider, GeocodeResponse, GeocodeRequest } from '../types/geocoding';

interface CensusAddressMatch {
  coordinates: {
    x: string;
    y: string;
  };
  addressComponents: {
    streetName?: string;
    preDirectional?: string;
    streetNamePostType?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  matchedAddress: string;
}

export class CensusProvider implements GeocodingProvider {
  name = 'census';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async geocode(address: string, _options?: GeocodeRequest['options']): Promise<GeocodeResponse> {
    try {
      // Check if this appears to be a US address
      if (!this.isUSAddress(address)) {
        return {
          success: false,
          provider: this.name,
          results: [],
          error: {
            code: 'NON_US_ADDRESS',
            message: 'Census geocoder only supports US addresses'
          }
        };
      }

      // Use the single address geocoding endpoint
      const url = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
      const params = new URLSearchParams({
        address: address,
        benchmark: 'Public_AR_Current', // Current benchmark
        format: 'json'
      });

      const response = await fetch(`${url}?${params}`);
      
      if (!response.ok) {
        throw new Error(`Census API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // Check if we got results
      if (!data.result || !data.result.addressMatches || data.result.addressMatches.length === 0) {
        return {
          success: true,
          provider: this.name,
          results: [],
        };
      }

      // Transform results to match our interface
      const results = data.result.addressMatches.map((match: CensusAddressMatch) => {
        const coordinates = match.coordinates;
        const addressComponents = match.addressComponents;
        
        return {
          latitude: parseFloat(coordinates.y),
          longitude: parseFloat(coordinates.x),
          formattedAddress: match.matchedAddress,
          confidence: this.calculateConfidence(match),
          components: {
            street: addressComponents.streetName ? 
              `${addressComponents.preDirectional || ''} ${addressComponents.streetName} ${addressComponents.streetNamePostType || ''}`.trim() : 
              undefined,
            city: addressComponents.city,
            state: addressComponents.state,
            country: 'United States',
            postalCode: addressComponents.zip
          },
          raw: match
        };
      });

      return {
        success: true,
        provider: this.name,
        results
      };

    } catch (error: unknown) {
      return {
        success: false,
        provider: this.name,
        results: [],
        error: {
          code: 'CENSUS_ERROR',
          message: (error as { message?: string }).message || 'Unknown error occurred'
        }
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Test with a known address
      const response = await this.geocode('1600 Pennsylvania Avenue NW, Washington, DC 20500');
      return response.success && response.results.length > 0;
    } catch {
      return false;
    }
  }

  getRateLimit() {
    return {
      requests: 100, // Census API is more generous
      period: 1000 // 1 second
    };
  }

  /**
   * Simple heuristic to detect if an address might be in the US
   * This checks for US state abbreviations, zip codes, and common US patterns
   */
  private isUSAddress(address: string): boolean {
    const addressUpper = address.toUpperCase();
    
    // Check for US state abbreviations (2-letter codes)
    const usStates = [
      'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
      'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
      'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
      'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
      'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
      'DC', 'PR' // Include DC and Puerto Rico
    ];
    
    // Check for state abbreviations
    const statePattern = new RegExp(`\\b(${usStates.join('|')})\\b`);
    if (statePattern.test(addressUpper)) {
      return true;
    }
    
    // Check for US zip code patterns (5 digits or 5+4)
    const zipPattern = /\b\d{5}(-\d{4})?\b/;
    if (zipPattern.test(address)) {
      return true;
    }
    
    // Check for common US format indicators
    const usIndicators = [
      'USA', 'US', 'UNITED STATES',
      'STREET', 'AVENUE', 'BOULEVARD', 'ROAD', 'LANE', 'DRIVE',
      'ST', 'AVE', 'BLVD', 'RD', 'LN', 'DR'
    ];
    
    for (const indicator of usIndicators) {
      if (addressUpper.includes(indicator)) {
        return true;
      }
    }
    
    // If country is explicitly specified and it's not US, return false
    if (addressUpper.includes('CANADA') || 
        addressUpper.includes('MEXICO') || 
        addressUpper.includes('UK') || 
        addressUpper.includes('ENGLAND') ||
        addressUpper.includes('FRANCE') ||
        addressUpper.includes('GERMANY')) {
      return false;
    }
    
    // Default to true for ambiguous cases (better to try Census first)
    return true;
  }

  /**
   * Calculate confidence score based on match quality
   */
  private calculateConfidence(match: CensusAddressMatch): number {
    // Census API provides match indicators, but for simplicity
    // we'll use a basic confidence scoring
    const matchType = match.matchedAddress ? 1 : 0.5;
    const hasCoordinates = match.coordinates ? 1 : 0;
    
    return Math.min(1, (matchType + hasCoordinates) / 2);
  }
} 