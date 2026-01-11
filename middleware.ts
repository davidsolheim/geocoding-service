import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // For the /health route, redirect to /api/v1/health
  if (request.nextUrl.pathname === '/health') {
    // Create a new URL for the API health endpoint
    const url = request.nextUrl.clone();
    url.pathname = '/api/v1/health';
    
    // Create a new request with the API key
    const requestHeaders = new Headers(request.headers);
    
    // Add the API key if not already present
    if (!requestHeaders.has('x-api-key') && process.env.DEFAULT_API_KEY) {
      requestHeaders.set('x-api-key', process.env.DEFAULT_API_KEY);
    }
    
    // Return a rewrite response with the headers
    return NextResponse.rewrite(url, {
      request: {
        headers: requestHeaders
      }
    });
  }

  // Continue with the request for all other routes
  return NextResponse.next();
}

// See: https://nextjs.org/docs/app/building-your-application/routing/middleware#matcher
export const config = {
  // Apply this middleware only to /health route
  matcher: '/health',
}; 