import { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  try {
    return Response.json({
      status: 'ok',
      service: 'Geocoding Service',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      endpoints: {
        geocoding: '/api/v1/geocode',
        reviews: '/api/v1/reviews',
        'place-search': '/api/v1/place-search',
        distance: '/api/v1/distance',
        'route-optimize': '/api/route-planner/optimize'
      }
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