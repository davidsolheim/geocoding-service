import { NextRequest } from 'next/server';
import { GoogleReviewsProvider } from '@/app/providers/googleReviews';
import { reviewRequestSchema } from '@/app/lib/validation';
import { validateApiKey, getApiKeyFromRequest } from '@/app/lib/auth';

export const runtime = 'edge';

// Initialize providers
const providers = [new GoogleReviewsProvider()];

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
    const result = reviewRequestSchema.safeParse(body);
    if (!result.success) {
      return Response.json(
        { error: 'Invalid request', details: result.error.errors },
        { status: 400 }
      );
    }

    console.log('Reviews API call:', body);
    const { placeId, maxResults, language, minimumRating, pageToken } = result.data;
    
    // Check if the client wants to use chunked loading
    // Get from searchParams (URL) or from body
    const searchParams = request.nextUrl.searchParams;
    const useChunkedLoading = 
      searchParams.get('chunked') === 'true' || 
      body.chunked === true;

    // Use Google provider by default (we can add more later)
    const provider = providers[0];

    // Check if provider is available
    const isAvailable = await provider.isAvailable();
    if (!isAvailable) {
      console.error('Reviews provider is not available');
      return Response.json(
        { error: 'Reviews provider is not available' },
        { status: 503 }
      );
    }

    // Get reviews for the single place ID
    console.log(`Requesting reviews for location: ${placeId} (using chunked: ${useChunkedLoading})`);
    
    // Use either chunked or regular loading method based on the flag
    const response = useChunkedLoading
      ? await provider.getReviewsChunked(placeId, {
          maxResults,
          language,
          minimumRating,
          pageToken
        })
      : await provider.getReviews(placeId, {
          maxResults,
          language,
          minimumRating,
          pageToken
        });
    
    // Log the summary for debugging
    if (response.summary) {
      console.log(`Returning summary for ${placeId}: ${response.summary.totalReviews} reviews with ${response.summary.rating} stars`);
    } else {
      console.warn(`No summary data for ${placeId}`);
    }
    
    return Response.json(response);
    
  } catch (error) {
    console.error('Reviews fetch error:', error);
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 