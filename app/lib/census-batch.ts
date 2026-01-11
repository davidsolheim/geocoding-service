/**
 * Utility functions for US Census Batch Geocoding
 * This can process up to 10,000 addresses at once for maximum cost efficiency
 */

export interface BatchGeocodeAddress {
  id: string;
  street: string;
  city: string;
  state: string;
  zip?: string;
}

export interface BatchGeocodeResult {
  id: string;
  inputAddress: string;
  matched: boolean;
  latitude?: number;
  longitude?: number;
  matchedAddress?: string;
  matchType?: string;
  coordinates?: string;
  tigerLineId?: string;
  side?: string;
}

/**
 * Format addresses for Census batch geocoding
 * Required format: Unique ID, Street address, City, State, ZIP
 */
function formatAddressesForBatch(addresses: BatchGeocodeAddress[]): string {
  const csvHeader = 'ID,Address,City,State,ZIP\n';
  const csvRows = addresses.map(addr => {
    // Escape commas and quotes in the data
    const escapeField = (field: string) => {
      if (field.includes(',') || field.includes('"')) {
        return `"${field.replace(/"/g, '""')}"`;
      }
      return field;
    };

    return [
      escapeField(addr.id),
      escapeField(addr.street),
      escapeField(addr.city),
      escapeField(addr.state),
      escapeField(addr.zip || ''),
    ].join(',');
  });

  return csvHeader + csvRows.join('\n');
}

/**
 * Parse Census batch geocoding results
 */
function parseBatchResults(csvData: string): BatchGeocodeResult[] {
  const lines = csvData.trim().split('\n');
  const results: BatchGeocodeResult[] = [];

  // Skip header line and process data
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // Split CSV line (simple parser - doesn't handle quoted commas perfectly)
    const fields = line.split(',');
    
    if (fields.length >= 5) {
      const [id, inputAddress, matched, matchType, coordinates, tigerLineId, side] = fields;
      
      let latitude: number | undefined;
      let longitude: number | undefined;
      
      // Parse coordinates if available
      if (coordinates && coordinates !== '') {
        const [lng, lat] = coordinates.split(',');
        latitude = parseFloat(lat);
        longitude = parseFloat(lng);
      }

      results.push({
        id: id.replace(/"/g, ''), // Remove quotes
        inputAddress: inputAddress.replace(/"/g, ''),
        matched: matched === 'Match',
        latitude,
        longitude,
        matchedAddress: matched === 'Match' ? inputAddress.replace(/"/g, '') : undefined,
        matchType: matchType?.replace(/"/g, ''),
        coordinates: coordinates?.replace(/"/g, ''),
        tigerLineId: tigerLineId?.replace(/"/g, ''),
        side: side?.replace(/"/g, '')
      });
    }
  }

  return results;
}

/**
 * Submit a batch of addresses for geocoding
 * Can handle up to 10,000 addresses in a single batch
 */
export async function submitBatchGeocode(
  addresses: BatchGeocodeAddress[],
  returnType: 'locations' | 'geographies' = 'locations',
  benchmark: string = 'Public_AR_Current'
): Promise<BatchGeocodeResult[]> {
  if (addresses.length === 0) {
    return [];
  }

  if (addresses.length > 10000) {
    throw new Error('Maximum 10,000 addresses allowed per batch');
  }

  // Format addresses as CSV
  const csvData = formatAddressesForBatch(addresses);

  // Create form data for the request
  const formData = new FormData();
  formData.append('addressFile', new Blob([csvData], { type: 'text/csv' }), 'addresses.csv');
  formData.append('benchmark', benchmark);
  formData.append('vintage', 'Current_Current'); // Usually current vintage

  // Submit to Census batch API
  const url = `https://geocoding.geo.census.gov/geocoder/${returnType}/addressbatch`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Census Batch API error: ${response.status} ${response.statusText}`);
    }

    const resultCsv = await response.text();
    return parseBatchResults(resultCsv);

  } catch (error) {
    console.error('Census batch geocoding error:', error);
    throw error;
  }
}

/**
 * Split a large batch into smaller chunks and process them
 * This is useful for processing more than 10,000 addresses
 */
export async function processLargeBatch(
  addresses: BatchGeocodeAddress[],
  chunkSize: number = 10000,
  returnType: 'locations' | 'geographies' = 'locations',
  benchmark: string = 'Public_AR_Current'
): Promise<BatchGeocodeResult[]> {
  const results: BatchGeocodeResult[] = [];
  
  for (let i = 0; i < addresses.length; i += chunkSize) {
    const chunk = addresses.slice(i, i + chunkSize);
    console.log(`Processing batch ${Math.floor(i / chunkSize) + 1} of ${Math.ceil(addresses.length / chunkSize)} (${chunk.length} addresses)`);
    
    try {
      const chunkResults = await submitBatchGeocode(chunk, returnType, benchmark);
      results.push(...chunkResults);
      
      // Add a small delay between batches to be respectful to the free service
      if (i + chunkSize < addresses.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`Error processing batch starting at index ${i}:`, error);
      // Continue with other batches even if one fails
    }
  }
  
  return results;
}

/**
 * Convert batch results back to the standard geocoding response format
 */
export function convertBatchResultsToStandardFormat(results: BatchGeocodeResult[]) {
  return results.map(result => ({
    success: result.matched,
    provider: 'census-batch',
    results: result.matched && result.latitude && result.longitude ? [{
      latitude: result.latitude,
      longitude: result.longitude,
      formattedAddress: result.matchedAddress || result.inputAddress,
      confidence: 0.9, // Census is generally high confidence for matches
      components: {
        country: 'United States'
      },
      raw: result
    }] : [],
    error: result.matched ? undefined : {
      code: 'NO_MATCH',
      message: 'Address could not be matched'
    }
  }));
} 