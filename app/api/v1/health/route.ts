import { NextRequest } from 'next/server';
import { GoogleProvider } from '@/app/providers/google';
import { GoogleReviewsProvider } from '@/app/providers/googleReviews';
import { validateApiKey, getApiKeyFromRequest } from '@/app/lib/auth';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  try {
    // Validate API key
    const apiKey = getApiKeyFromRequest(request);
    if (!validateApiKey(apiKey)) {
      return Response.json(
        { error: 'Unauthorized - Invalid API key' },
        { status: 401 }
      );
    }

    const geocodingProvider = new GoogleProvider();
    const reviewsProvider = new GoogleReviewsProvider();
    
    const [geocodingAvailable, reviewsAvailable] = await Promise.all([
      geocodingProvider.isAvailable(),
      reviewsProvider.isAvailable()
    ]);

    return Response.json({
      status: 'ok',
      providers: {
        'google-geocoding': geocodingAvailable,
        'google-reviews': reviewsAvailable
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Health check error:', error);
    return Response.json({
      status: 'error',
      error: 'Service health check failed',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
} 