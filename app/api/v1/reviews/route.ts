import { NextRequest } from 'next/server';
import { GoogleReviewsProvider } from '@/app/providers/googleReviews';
import { reviewRequestSchema } from '@/app/lib/validation';
import { validateApiKey, getApiKeyFromRequest } from '@/app/lib/auth';

export const runtime = 'edge';

// Initialize providers
const providers = [new GoogleReviewsProvider()];

// Helper to mask API key for logging (show first 4 and last 4 chars)
function maskApiKey(apiKey: string | undefined): string {
  if (!apiKey) return 'none';
  if (apiKey.length <= 8) return '***';
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

// Generate a short request ID for log correlation
function generateRequestId(): string {
  return Math.random().toString(36).substring(2, 10);
}

export async function POST(request: NextRequest) {
  const requestId = generateRequestId();
  const startTime = performance.now();
  
  const log = (level: 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>) => {
    const logData = {
      requestId,
      endpoint: '/api/v1/reviews',
      timestamp: new Date().toISOString(),
      ...data
    };
    const formattedMessage = `[reviews] ${message}`;
    if (level === 'error') {
      console.error(formattedMessage, JSON.stringify(logData));
    } else if (level === 'warn') {
      console.warn(formattedMessage, JSON.stringify(logData));
    } else {
      console.log(formattedMessage, JSON.stringify(logData));
    }
  };

  try {
    // Validate API key
    const apiKey = getApiKeyFromRequest(request);
    const maskedKey = maskApiKey(apiKey);
    
    if (!validateApiKey(apiKey)) {
      log('warn', 'Unauthorized request - invalid API key', { 
        apiKey: maskedKey,
        ip: request.headers.get('x-forwarded-for') || 'unknown'
      });
      return Response.json(
        { error: 'Unauthorized - Invalid API key' },
        { status: 401 }
      );
    }

    const body = await request.json();
    
    // Validate request
    const result = reviewRequestSchema.safeParse(body);
    if (!result.success) {
      log('warn', 'Validation failed', { 
        apiKey: maskedKey,
        errors: result.error.errors,
        body: JSON.stringify(body).slice(0, 200) // Truncate for safety
      });
      return Response.json(
        { error: 'Invalid request', details: result.error.errors },
        { status: 400 }
      );
    }

    const { placeId, maxResults, language, minimumRating, pageToken } = result.data;
    
    // Check if the client wants to use chunked loading
    // Get from searchParams (URL) or from body
    const searchParams = request.nextUrl.searchParams;
    const useChunkedLoading = 
      searchParams.get('chunked') === 'true' || 
      body.chunked === true;

    log('info', 'Processing reviews request', {
      apiKey: maskedKey,
      placeId,
      maxResults,
      language,
      minimumRating,
      chunked: useChunkedLoading,
      hasPageToken: !!pageToken
    });

    // Use Google provider by default (we can add more later)
    const provider = providers[0];

    // Check if provider is available
    const isAvailable = await provider.isAvailable();
    if (!isAvailable) {
      log('error', 'Provider unavailable', { 
        provider: 'google',
        placeId
      });
      return Response.json(
        { error: 'Reviews provider is not available' },
        { status: 503 }
      );
    }

    const providerStartTime = performance.now();
    
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
    
    const providerDuration = Math.round(performance.now() - providerStartTime);
    const totalDuration = Math.round(performance.now() - startTime);
    
    // Log response details
    const reviewCount = response.results?.length ?? 0;
    log('info', 'Request completed successfully', {
      placeId,
      reviewCount,
      hasNextPageToken: !!response.pagination?.nextPageToken,
      summaryRating: response.summary?.rating,
      summaryTotalReviews: response.summary?.totalReviews,
      providerDurationMs: providerDuration,
      totalDurationMs: totalDuration
    });

    if (!response.summary) {
      log('warn', 'No summary data in response', { placeId });
    }
    
    return Response.json(response);
    
  } catch (error) {
    const totalDuration = Math.round(performance.now() - startTime);
    log('error', 'Request failed with exception', { 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      totalDurationMs: totalDuration
    });
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 