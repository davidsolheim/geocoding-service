import { NextRequest } from 'next/server';
import { GoogleProvider } from '@/app/providers/google';
import { CensusProvider } from '@/app/providers/census';
import { geocodeRequestSchema } from '@/app/lib/validation';
import { validateApiKey, getApiKeyFromRequest } from '@/app/lib/auth';

export const runtime = 'edge';

// Initialize providers - Census first for cost savings on US addresses
const providers = [new CensusProvider(), new GoogleProvider()];

export async function POST(request: NextRequest) {
  try {
    // Validate API key
    const apiKey = getApiKeyFromRequest(request);
    if (!validateApiKey(apiKey)) {
      return Response.json(
        { error: 'Unauthorized - Invalid API key' },
        { status: 401 }
      );
    }

    const body = await request.json();
    
    // Validate request
    const result = geocodeRequestSchema.safeParse(body);
    if (!result.success) {
      return Response.json(
        { error: 'Invalid request', details: result.error.errors },
        { status: 400 }
      );
    }

    const { address, provider: preferredProvider, options } = result.data;

    // If a specific provider is requested, use only that one
    if (preferredProvider) {
      const provider = providers.find(p => p.name === preferredProvider);
      if (!provider) {
        return Response.json(
          { error: 'Provider not found or not available' },
          { status: 400 }
        );
      }

      // Check if provider is available
      const isAvailable = await provider.isAvailable();
      if (!isAvailable) {
        return Response.json(
          { error: 'Selected provider is not available' },
          { status: 503 }
        );
      }

      // Geocode with specific provider
      const response = await provider.geocode(address, options);
      return Response.json(response);
    }

    // Try providers in order (Census first for cost savings, then Google as fallback)
    let lastError = null;
    for (const provider of providers) {
      try {
        // Check if provider is available
        const isAvailable = await provider.isAvailable();
        if (!isAvailable) {
          console.warn(`Provider ${provider.name} is not available, trying next provider`);
          continue;
        }

        // Try geocoding with this provider
        const response = await provider.geocode(address, options);
        
        // If successful and has results, return immediately
        if (response.success && response.results.length > 0) {
          return Response.json(response);
        }
        
        // If no results but no error, continue to next provider
        if (response.success && response.results.length === 0) {
          console.log(`Provider ${provider.name} returned no results, trying next provider`);
          continue;
        }
        
        // If there was an error, store it and try next provider
        if (!response.success) {
          lastError = response.error;
          console.warn(`Provider ${provider.name} failed:`, response.error);
          continue;
        }
        
      } catch (error) {
        console.error(`Error with provider ${provider.name}:`, error);
        lastError = {
          code: 'PROVIDER_ERROR',  
          message: `Provider ${provider.name} encountered an error`
        };
        continue;
      }
    }

    // If we get here, all providers failed
    return Response.json({
      success: false,
      provider: 'multiple',
      results: [],
      error: lastError || {
        code: 'ALL_PROVIDERS_FAILED',
        message: 'All geocoding providers failed or returned no results'
      }
    });
    
  } catch (error) {
    console.error('Geocoding error:', error);
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 