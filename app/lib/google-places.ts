/**
 * Utility functions for interacting with Google Places API (New)
 * 
 * This implementation uses the new Places API endpoints (places.googleapis.com/v1)
 * instead of the legacy endpoints (maps.googleapis.com/maps/api/place).
 */

const PLACES_API_BASE = 'https://places.googleapis.com/v1';

/**
 * Search for a place by various parameters
 */
export interface PlaceSearchParams {
  name?: string;
  phone?: string;
  city?: string;
  cid?: string;
  latitude?: number;
  longitude?: number;
  useAutocomplete?: boolean;
}

export interface PlaceSearchResult {
  status: string;
  candidates: Array<{
    place_id: string;
    name: string;
    formatted_address: string;
    geometry?: {
      location: {
        lat: number;
        lng: number;
      };
    };
    types?: string[];
  }>;
}

/**
 * Interface for Google Places API (New) result
 */
interface GooglePlacesNewResult {
  id: string;
  displayName?: {
    text: string;
    languageCode?: string;
  };
  formattedAddress?: string;
  location?: {
    latitude: number;
    longitude: number;
  };
  types?: string[];
}

/**
 * Interface for Autocomplete prediction
 */
interface AutocompletePrediction {
  placePrediction?: {
    placeId: string;
    text?: {
      text: string;
    };
    structuredFormat?: {
      mainText?: { text: string };
      secondaryText?: { text: string };
    };
  };
}

/**
 * Helper to get the API key
 */
function getApiKey(): string {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
  if (!apiKey) {
    console.warn('⚠️ GOOGLE_PLACES_API_KEY or GOOGLE_MAPS_API_KEY environment variable is not set.');
  }
  return apiKey;
}

/**
 * Transform new API result to legacy format for compatibility
 */
function transformToLegacyFormat(result: GooglePlacesNewResult): PlaceSearchResult['candidates'][0] {
  return {
    place_id: result.id,
    name: result.displayName?.text || '',
    formatted_address: result.formattedAddress || '',
    geometry: result.location ? {
      location: {
        lat: result.location.latitude,
        lng: result.location.longitude
      }
    } : undefined,
    types: result.types
  };
}

/**
 * Search for a place using the Google Places API
 */
export async function searchForPlace(params: PlaceSearchParams): Promise<PlaceSearchResult> {
  const { name, phone, city, cid, latitude, longitude, useAutocomplete } = params;
  
  if (!name && !phone && !city && !cid && !(latitude && longitude)) {
    throw new Error('At least one search parameter (name, phone, city, cid, or coordinates) is required');
  }

  // If we have coordinates, try to search by that first as it's extremely precise
  if (latitude !== undefined && longitude !== undefined) {
    try {
      const coordResult = await searchByCoordinates(latitude, longitude);
      if (coordResult.status === 'OK' && coordResult.candidates.length > 0) {
        return coordResult;
      }
    } catch (error) {
      console.warn('Coordinate search failed, falling back to other search methods:', error);
      // Continue with other search methods if coordinate search fails
    }
  }

  // If we have a CID, try to search by that as it's also very specific
  if (cid) {
    try {
      const cidResult = await searchByCid(cid);
      if (cidResult.status === 'OK' && cidResult.candidates.length > 0) {
        return cidResult;
      }
    } catch (error) {
      console.warn('CID search failed, falling back to other search methods:', error);
      // Continue with other search methods if CID search fails
    }
  }

  // If we have a business name and useAutocomplete is true, try the Autocomplete API
  if (name && (useAutocomplete === true)) {
    try {
      let query = name;
      if (city) query += ` ${city}`;
      
      const autocompleteResult = await searchWithAutocomplete(query);
      if (autocompleteResult.status === 'OK' && autocompleteResult.candidates.length > 0) {
        return autocompleteResult;
      }
    } catch (error) {
      console.warn('Autocomplete search failed, falling back to other search methods:', error);
      // Continue with other search methods if autocomplete search fails
    }
  }

  // If we have a phone number, try to search by phone
  if (phone) {
    try {
      const phoneResult = await searchByPhone(phone, city);
      if (phoneResult.status === 'OK' && phoneResult.candidates.length > 0) {
        return phoneResult;
      }
    } catch (error) {
      console.warn('Phone search failed, falling back to text search:', error);
      // Continue with regular search if phone search fails
    }
  }
  
  // Build search query for text search (our fallback method)
  let query = '';
  if (name) query += name;
  if (city) query += query ? ` ${city}` : city;
  
  // If we have no query text but have other parameters, use them as fallbacks
  if (!query) {
    if (phone) query = phone;
    else if (cid) query = `cid:${cid}`;
    else if (latitude !== undefined && longitude !== undefined) query = `${latitude},${longitude}`;
  }

  // If we still have a query to search with, try both autocomplete and regular search
  if (query) {
    // Try autocomplete even if not explicitly requested as a last resort
    if (name && useAutocomplete !== false) {
      try {
        const autocompleteResult = await searchWithAutocomplete(query);
        if (autocompleteResult.status === 'OK' && autocompleteResult.candidates.length > 0) {
          return autocompleteResult;
        }
      } catch (error) {
        console.warn('Fallback autocomplete search failed:', error);
        // Continue with text search if autocomplete fails
      }
    }

    // Use the new Places API Text Search
    return await textSearch(query, latitude, longitude);
  }

  // If we get here, all searches failed
  return { status: 'ZERO_RESULTS', candidates: [] };
}

/**
 * Text Search using the new Places API
 */
async function textSearch(
  query: string, 
  latitude?: number, 
  longitude?: number
): Promise<PlaceSearchResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { status: 'API_KEY_MISSING', candidates: [] };
  }

  const requestBody: {
    textQuery: string;
    locationBias?: {
      circle: {
        center: { latitude: number; longitude: number };
        radius: number;
      };
    };
  } = {
    textQuery: query
  };

  // Add location bias if we have coordinates
  if (latitude !== undefined && longitude !== undefined) {
    requestBody.locationBias = {
      circle: {
        center: { latitude, longitude },
        radius: 5000
      }
    };
  }

  try {
    const response = await fetch(`${PLACES_API_BASE}/places:searchText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types'
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();

    if (data.error) {
      console.error('Google Places API error:', data.error);
      return { status: data.error.status || 'ERROR', candidates: [] };
    }

    const candidates = (data.places || []).map(transformToLegacyFormat);
    
    return {
      status: candidates.length > 0 ? 'OK' : 'ZERO_RESULTS',
      candidates
    };
  } catch (error) {
    console.error('Error in text search:', error);
    return { status: 'ERROR', candidates: [] };
  }
}

/**
 * Helper function to search by phone number using Text Search
 */
async function searchByPhone(
  phone: string,
  city?: string
): Promise<PlaceSearchResult> {
  // Clean the phone number (remove non-numeric characters)
  const cleanPhone = phone.replace(/\D/g, '');
  
  // Try to format the phone for better results
  // Add country code if it appears to be a US number without one
  const formattedPhone = cleanPhone.length === 10 ? `+1${cleanPhone}` : cleanPhone;
  
  // Build search query with phone and optionally city
  let query = formattedPhone;
  if (city) query += ` ${city}`;

  return await textSearch(query);
}

/**
 * Get place details by place ID using the new Places API
 */
export async function getPlaceDetails(placeId: string) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Google API key is not configured');
  }

  try {
    const response = await fetch(`${PLACES_API_BASE}/places/${placeId}`, {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'id,displayName,formattedAddress,location,nationalPhoneNumber,websiteUri,businessStatus,types'
      }
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(`Google Places API error: ${data.error.status || data.error.message}`);
    }

    // Transform to legacy format for compatibility
    return {
      place_id: data.id,
      name: data.displayName?.text || '',
      formatted_address: data.formattedAddress || '',
      geometry: data.location ? {
        location: {
          lat: data.location.latitude,
          lng: data.location.longitude
        }
      } : undefined,
      formatted_phone_number: data.nationalPhoneNumber,
      website: data.websiteUri,
      business_status: data.businessStatus,
      types: data.types
    };
  } catch (error) {
    console.error('Error getting place details:', error);
    throw error;
  }
}

/**
 * Extract CID from a Google Maps URL
 */
export function extractCidFromUrl(url: string): string | null {
  if (!url) return null;
  
  // Try to match CID pattern in different Google Maps URL formats
  const cidMatch = url.match(/[?&]cid=([0-9]+)/);
  if (cidMatch && cidMatch[1]) {
    return cidMatch[1];
  }
  
  return null;
}

/**
 * Helper function to try to find a place by CID
 * This is experimental as Google doesn't officially support CID in their API
 * but we can try our best by using it in a text search query
 */
export async function searchByCid(cid: string): Promise<PlaceSearchResult> {
  if (!cid) {
    return { status: 'ZERO_RESULTS', candidates: [] };
  }
  
  // If CID is numeric, use it directly in a text search
  const numericCid = cid.match(/^\d+$/) ? cid : null;
  if (!numericCid) {
    return { status: 'ZERO_RESULTS', candidates: [] };
  }
  
  // Try to use the CID in a text search query
  // This is not guaranteed to work but sometimes Google can match it
  return await textSearch(`cid:${numericCid}`);
}

/**
 * Search for a place by exact coordinates using Nearby Search
 */
export async function searchByCoordinates(
  latitude: number,
  longitude: number
): Promise<PlaceSearchResult> {
  if (!latitude || !longitude) {
    return { status: 'ZERO_RESULTS', candidates: [] };
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return { status: 'API_KEY_MISSING', candidates: [] };
  }

  try {
    // Use the new Nearby Search API
    const response = await fetch(`${PLACES_API_BASE}/places:searchNearby`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types'
      },
      body: JSON.stringify({
        locationRestriction: {
          circle: {
            center: { latitude, longitude },
            radius: 100 // Search within 100 meters
          }
        },
        maxResultCount: 5
      })
    });

    const data = await response.json();

    if (data.error) {
      console.warn(`Google Places API error for coordinate search: ${data.error.status}`);
      return { status: 'ZERO_RESULTS', candidates: [] };
    }

    const candidates = (data.places || []).map(transformToLegacyFormat);
    
    return {
      status: candidates.length > 0 ? 'OK' : 'ZERO_RESULTS',
      candidates
    };
  } catch (error) {
    console.warn('Error searching by coordinates:', error);
    return { status: 'ZERO_RESULTS', candidates: [] };
  }
}

/**
 * Search for a place using the Places Autocomplete API (New)
 * This often has better matching for business names
 */
export async function searchWithAutocomplete(
  query: string, 
  types: string = 'establishment'
): Promise<PlaceSearchResult> {
  if (!query) {
    return { status: 'ZERO_RESULTS', candidates: [] };
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return { status: 'API_KEY_MISSING', candidates: [] };
  }

  try {
    // Map legacy types to new API format
    const includedPrimaryTypes = types === 'establishment' ? ['establishment'] : [types];

    // Use the new Autocomplete API
    const response = await fetch(`${PLACES_API_BASE}/places:autocomplete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey
      },
      body: JSON.stringify({
        input: query,
        includedPrimaryTypes
      })
    });

    const data = await response.json();

    if (data.error) {
      console.warn(`Google Places Autocomplete API error: ${data.error.status}`);
      return { status: 'ZERO_RESULTS', candidates: [] };
    }

    // If we have predictions (now called suggestions), get details for each place
    if (data.suggestions && data.suggestions.length > 0) {
      const placeResults = await Promise.all(
        data.suggestions.slice(0, 5).map(async (suggestion: AutocompletePrediction) => {
          const placeId = suggestion.placePrediction?.placeId;
          if (!placeId) return null;
          
          try {
            const details = await getPlaceDetails(placeId);
            return {
              place_id: placeId,
              name: details.name || suggestion.placePrediction?.structuredFormat?.mainText?.text || '',
              formatted_address: details.formatted_address || suggestion.placePrediction?.structuredFormat?.secondaryText?.text || '',
              geometry: details.geometry,
              types: details.types
            };
          } catch (error) {
            console.warn(`Error getting details for place ${placeId}:`, error);
            return null;
          }
        })
      );
      
      // Filter out any null results and return
      const validResults = placeResults.filter(Boolean) as PlaceSearchResult['candidates'];
      return {
        status: validResults.length > 0 ? 'OK' : 'ZERO_RESULTS',
        candidates: validResults
      };
    }
    
    return { status: 'ZERO_RESULTS', candidates: [] };
  } catch (error) {
    console.warn('Error searching with autocomplete:', error);
    return { status: 'ZERO_RESULTS', candidates: [] };
  }
}
