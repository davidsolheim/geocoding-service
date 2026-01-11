import { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  try {
    // Forward the request to the API V1 health endpoint
    const apiUrl = new URL(request.url);
    const baseUrl = `${apiUrl.protocol}//${apiUrl.host}`;
    const healthUrl = `${baseUrl}/api/v1/health`;
    
    // Create headers with the API key
    const headers = new Headers(request.headers);
    
    // Check for an API key in the request, or use the default one from environment variables
    const apiKey = request.headers.get('x-api-key') || process.env.DEFAULT_API_KEY;
    if (apiKey) {
      headers.set('x-api-key', apiKey);
    }
    
    // Forward any query parameters with the API key
    const response = await fetch(healthUrl + apiUrl.search, {
      headers
    });
    
    return response;
  } catch (error) {
    console.error('Health route error:', error);
    return Response.json({
      status: 'error',
      error: 'Health check failed',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
} 