/**
 * Utility functions for interacting with Google Places API
 */

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
 * Interface for Google Places Text Search API result
 */
interface GooglePlacesTextSearchResult {
  place_id: string;
  name: string;
  formatted_address: string;
  geometry: {
    location: {
      lat: number;
      lng: number;
    };
  };
  types?: string[];
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
        // Continue with findplacefromtext if autocomplete fails
      }
    }

    // Construct the URL for Google Place Search API (findplacefromtext)
    let url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?key=${process.env.GOOGLE_PLACES_API_KEY}&inputtype=textquery`;
    
    // Add query parameters
    url += `&input=${encodeURIComponent(query)}`;
    
    // Add fields to retrieve
    url += '&fields=place_id,name,formatted_address,geometry,types';
    
    // Add location bias if we have coordinates
    if (latitude !== undefined && longitude !== undefined) {
      url += `&locationbias=circle:5000@${latitude},${longitude}`;
    }

    // Make the request to Google
    const response = await fetch(url);
    const data = await response.json();

    // Check if the request was successful
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      throw new Error(`Google Places API error: ${data.status}`);
    }

    return {
      status: data.status,
      candidates: data.candidates || [],
    };
  }

  // If we get here, all searches failed
  return { status: 'ZERO_RESULTS', candidates: [] };
}

/**
 * Helper function to search by phone number
 * Note: This is a workaround since Google's Find Place API doesn't directly
 * support phone search. We use the Text Search API which provides limited
 * support for phone numbers in some regions.
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

  // Use Text Search API which has better support for phone queries
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${process.env.GOOGLE_PLACES_API_KEY}`;
  
  const response = await fetch(url);
  const data = await response.json();
  
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(`Google Places API error: ${data.status}`);
  }
  
  // Transform the results to match our PlaceSearchResult interface
  return {
    status: data.status,
    candidates: data.results?.map((result: GooglePlacesTextSearchResult) => ({
      place_id: result.place_id,
      name: result.name,
      formatted_address: result.formatted_address,
      geometry: result.geometry,
      types: result.types
    })) || [],
  };
}

/**
 * Get place details by place ID
 */
export async function getPlaceDetails(placeId: string) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${process.env.GOOGLE_PLACES_API_KEY}&fields=name,formatted_address,geometry,formatted_phone_number,website,business_status,types`;
  
  const response = await fetch(url);
  const data = await response.json();
  
  if (data.status !== 'OK') {
    throw new Error(`Google Places API error: ${data.status}`);
  }
  
  return data.result;
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
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=cid:${encodeURIComponent(numericCid)}&key=${process.env.GOOGLE_PLACES_API_KEY}`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.warn(`Google Places API error for CID search: ${data.status}`);
      return { status: 'ZERO_RESULTS', candidates: [] };
    }
    
    return {
      status: data.status,
      candidates: data.results?.map((result: GooglePlacesTextSearchResult) => ({
        place_id: result.place_id,
        name: result.name,
        formatted_address: result.formatted_address,
        geometry: result.geometry,
        types: result.types
      })) || [],
    };
  } catch (error) {
    console.warn('Error searching by CID:', error);
    return { status: 'ZERO_RESULTS', candidates: [] };
  }
}

/**
 * Search for a place by exact coordinates
 */
export async function searchByCoordinates(
  latitude: number,
  longitude: number
): Promise<PlaceSearchResult> {
  if (!latitude || !longitude) {
    return { status: 'ZERO_RESULTS', candidates: [] };
  }
  
  // Use the Find Place API with location bias to find places near these coordinates
  const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?key=${process.env.GOOGLE_PLACES_API_KEY}&inputtype=textquery&input=place&locationbias=circle:100@${latitude},${longitude}&fields=place_id,name,formatted_address,geometry,types`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.warn(`Google Places API error for coordinate search: ${data.status}`);
      return { status: 'ZERO_RESULTS', candidates: [] };
    }
    
    return {
      status: data.status,
      candidates: data.candidates || [],
    };
  } catch (error) {
    console.warn('Error searching by coordinates:', error);
    return { status: 'ZERO_RESULTS', candidates: [] };
  }
}

/**
 * Search for a place using the Places Autocomplete API
 * This often has better matching for business names
 */
export async function searchWithAutocomplete(
  query: string, 
  types: string = 'establishment'
): Promise<PlaceSearchResult> {
  if (!query) {
    return { status: 'ZERO_RESULTS', candidates: [] };
  }
  
  // Use the Places Autocomplete API to get predictions
  const autocompleteUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&types=${types}&key=${process.env.GOOGLE_PLACES_API_KEY}`;
  
  try {
    const response = await fetch(autocompleteUrl);
    const data = await response.json();
    
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.warn(`Google Places Autocomplete API error: ${data.status}`);
      return { status: 'ZERO_RESULTS', candidates: [] };
    }
    
    // If we have predictions, get details for each place
    if (data.predictions && data.predictions.length > 0) {
      const placeResults = await Promise.all(
        data.predictions.slice(0, 5).map(async (prediction: { place_id: string; description: string }) => {
          try {
            const details = await getPlaceDetails(prediction.place_id);
            return {
              place_id: prediction.place_id,
              name: details.name || prediction.description,
              formatted_address: details.formatted_address || '',
              geometry: details.geometry,
              types: details.types
            };
          } catch (error) {
            console.warn(`Error getting details for place ${prediction.place_id}:`, error);
            return null;
          }
        })
      );
      
      // Filter out any null results and return
      const validResults = placeResults.filter(Boolean);
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