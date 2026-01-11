import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '@/app/lib/auth';
import { searchForPlace } from '@/app/lib/google-places';
import { z } from 'zod';

// Define the validation schema for the request body
const PlaceSearchSchema = z.object({
  name: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  city: z.string().trim().optional(),
  cid: z.string().trim().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  useAutocomplete: z.boolean().optional(),
}).refine(data => {
  // At least one of the primary search fields must be provided
  return Boolean(
    data.name || 
    data.phone || 
    data.city || 
    data.cid || 
    (data.latitude !== undefined && data.longitude !== undefined)
  );
}, {
  message: 'At least one search parameter (name, phone, city, cid, or coordinates) is required',
  path: ['name']
}).refine(data => {
  // If one coordinate is provided, both must be provided
  if (data.latitude !== undefined && data.longitude === undefined) {
    return false;
  }
  if (data.longitude !== undefined && data.latitude === undefined) {
    return false;
  }
  return true;
}, {
  message: 'Both latitude and longitude must be provided together',
  path: ['latitude']
});

export async function POST(request: NextRequest) {
  try {
    // Validate API key
    const apiKey = request.headers.get('x-api-key') || undefined;
    if (!validateApiKey(apiKey)) {
      return NextResponse.json(
        { error: 'Invalid API key' },
        { status: 401 }
      );
    }

    // Parse request body
    const body = await request.json();
    
    // Validate the request body against the schema
    const result = PlaceSearchSchema.safeParse(body);
    if (!result.success) {
      // If validation fails, return a 400 Bad Request response
      return NextResponse.json(
        { 
          error: 'Invalid request body',
          details: result.error.format()
        },
        { status: 400 }
      );
    }

    // Use the validated data
    const validatedData = result.data;
    
    // Use the utility function to search for places
    const searchResult = await searchForPlace(validatedData);

    // Return the response
    return NextResponse.json(searchResult);
  } catch (error) {
    console.error('Error in place search route:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
} 