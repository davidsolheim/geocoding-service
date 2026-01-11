# Next.js Geocoding Service Implementation Guide

## 1. Project Setup

### Initialize Project
```bash
npx create-next-app@latest geocoding-service --typescript --tailwind --app
cd geocoding-service
```

### Core Dependencies
```bash
npm install @upstash/redis @upstash/ratelimit axios zod
npm install -D @types/node @types/react
```

## 2. Project Structure
```
├── app/
│   ├── api/
│   │   ├── v1/
│   │   │   ├── geocode/
│   │   │   │   └── route.ts
│   │   │   ├── health/
│   │   │   │   └── route.ts
│   │   │   └── providers/
│   │   │       └── route.ts
│   ├── providers/
│   │   ├── google.ts
│   │   ├── mapbox.ts
│   │   └── index.ts
│   ├── lib/
│   │   ├── cache.ts
│   │   ├── rate-limit.ts
│   │   └── validation.ts
│   └── types/
│       └── geocoding.ts
├── middleware.ts
└── next.config.js
```

## 3. Core Implementation

### Type Definitions (types/geocoding.ts)
```typescript
export interface GeocodeRequest {
  address: string;
  provider?: string;
  options?: {
    country?: string;
    language?: string;
    bounds?: {
      northeast: { lat: number; lng: number };
      southwest: { lat: number; lng: number };
    };
  };
}

export interface GeocodeResponse {
  success: boolean;
  provider: string;
  results: {
    latitude: number;
    longitude: number;
    formattedAddress: string;
    confidence: number;
    components: {
      street?: string;
      city?: string;
      state?: string;
      country?: string;
      postalCode?: string;
    };
    raw?: any;
  }[];
  error?: {
    code: string;
    message: string;
  };
}

export interface GeocodingProvider {
  name: string;
  geocode(address: string, options?: any): Promise<GeocodeResponse>;
  isAvailable(): Promise<boolean>;
  getRateLimit(): {
    requests: number;
    period: number;
  };
}
```

### Provider Implementation (providers/google.ts)
```typescript
import { GeocodingProvider, GeocodeResponse } from '../types/geocoding';
import axios from 'axios';

export class GoogleProvider implements GeocodingProvider {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.GOOGLE_MAPS_API_KEY!;
  }

  name = 'google';

  async geocode(address: string, options?: any): Promise<GeocodeResponse> {
    try {
      const response = await axios.get(
        'https://maps.googleapis.com/maps/api/geocode/json',
        {
          params: {
            address,
            key: this.apiKey,
            ...options
          }
        }
      );

      return {
        success: true,
        provider: this.name,
        results: response.data.results.map(this.transformResult)
      };
    } catch (error) {
      throw new Error(`Geocoding failed: ${error.message}`);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.geocode('1600 Amphitheatre Parkway, Mountain View, CA');
      return true;
    } catch {
      return false;
    }
  }

  getRateLimit() {
    return {
      requests: 50,
      period: 1000 // 1 second
    };
  }

  private transformResult(result: any) {
    return {
      latitude: result.geometry.location.lat,
      longitude: result.geometry.location.lng,
      formattedAddress: result.formatted_address,
      confidence: 1,
      components: {
        street: result.address_components.find(c => c.types.includes('route'))?.long_name,
        city: result.address_components.find(c => c.types.includes('locality'))?.long_name,
        state: result.address_components.find(c => c.types.includes('administrative_area_level_1'))?.long_name,
        country: result.address_components.find(c => c.types.includes('country'))?.long_name,
        postalCode: result.address_components.find(c => c.types.includes('postal_code'))?.long_name
      },
      raw: result
    };
  }
}
```

### Cache Implementation (lib/cache.ts)
```typescript
import { Redis } from '@upstash/redis';
import { GeocodeResponse } from '../types/geocoding';

export class GeocodeCache {
  private redis: Redis;
  private ttl: number;

  constructor() {
    this.redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!
    });
    this.ttl = Number(process.env.CACHE_TTL_HOURS || 24) * 3600;
  }

  async get(key: string): Promise<GeocodeResponse | null> {
    const cached = await this.redis.get<string>(key);
    return cached ? JSON.parse(cached) : null;
  }

  async set(key: string, value: GeocodeResponse): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), {
      ex: this.ttl
    });
  }
}

export const cache = new GeocodeCache();
```

### Rate Limiting (lib/rate-limit.ts)
```typescript
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!
});

export const rateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, '15 m'),
  analytics: true
});
```

### Middleware (middleware.ts)
```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { rateLimiter } from './lib/rate-limit';

export async function middleware(request: NextRequest) {
  // Only apply to API routes
  if (!request.nextUrl.pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  const ip = request.ip ?? '127.0.0.1';
  const { success, pending, limit, reset, remaining } = await rateLimiter.limit(
    `ratelimit_${ip}`
  );

  if (!success) {
    return new NextResponse('Too Many Requests', {
      status: 429,
      headers: {
        'X-RateLimit-Limit': limit.toString(),
        'X-RateLimit-Remaining': remaining.toString(),
        'X-RateLimit-Reset': reset.toString()
      }
    });
  }

  const response = NextResponse.next();

  // Add rate limit headers
  response.headers.set('X-RateLimit-Limit', limit.toString());
  response.headers.set('X-RateLimit-Remaining', remaining.toString());
  response.headers.set('X-RateLimit-Reset', reset.toString());

  return response;
}

export const config = {
  matcher: '/api/:path*'
};
```

### API Route Implementation (app/api/v1/geocode/route.ts)
```typescript
import { NextRequest } from 'next/server';
import { cache } from '@/lib/cache';
import { providers } from '@/providers';
import { GeocodeRequest } from '@/types/geocoding';
import { geocodeRequestSchema } from '@/lib/validation';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  try {
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

    // Check cache
    const cacheKey = `geocode:${address}:${JSON.stringify(options)}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return Response.json(cached);
    }

    // Get provider
    const provider = preferredProvider
      ? providers.find(p => p.name === preferredProvider)
      : providers[0];

    if (!provider) {
      return Response.json(
        { error: 'Provider not found' },
        { status: 400 }
      );
    }

    // Geocode
    const response = await provider.geocode(address, options);
    
    // Cache result
    await cache.set(cacheKey, response);

    return Response.json(response);
  } catch (error) {
    console.error('Geocoding error:', error);
    return Response.json(
      { error: 'Geocoding failed' },
      { status: 500 }
    );
  }
}
```

## 4. Deployment Configuration

### Environment Variables (.env)
```env
GOOGLE_MAPS_API_KEY=
MAPBOX_API_KEY=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
CACHE_TTL_HOURS=24
```

### Vercel Configuration (vercel.json)
```json
{
  "regions": ["iad1"],
  "functions": {
    "app/api/**/*.ts": {
      "memory": 1024,
      "maxDuration": 10
    }
  }
}
```

## 5. Usage from Other Next.js Apps

### Client Integration
```typescript
// utils/geocoding.ts
export async function geocodeAddress(
  address: string,
  options?: GeocodeRequest['options']
): Promise<GeocodeResponse> {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_GEOCODING_SERVICE}/api/v1/geocode`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GEOCODING_API_KEY}`
      },
      body: JSON.stringify({ address, options })
    }
  );

  if (!response.ok) {
    throw new Error('Geocoding request failed');
  }

  return response.json();
}
```

## 6. Monitoring and Logging

### Vercel Analytics
```typescript
// app/api/v1/geocode/route.ts
import { trace } from '@vercel/trace';

export async function POST(request: NextRequest) {
  return trace('geocode', async (span) => {
    span.setAttributes({
      'geocode.address': address,
      'geocode.provider': provider.name
    });
    
    // ... rest of the code
  });
}
```

### Error Tracking
Consider integrating with services like Sentry or DataDog for error tracking and monitoring.
