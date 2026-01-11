import { NextRequest, NextResponse } from 'next/server';

interface Location {
  latitude: number;
  longitude: number;
}

interface OptimizationJob {
  id: string;
  address: string | null;
  scheduledDate: string;
  scheduledEndDate?: string | null;
  coordinates?: Location;
}

interface OptimizationJobWithCoordinates extends OptimizationJob {
  coordinates: Location;
}

interface RouteResponse {
  routes: Array<{
    duration: string;
    distanceMeters: number;
    polyline: {
      encodedPolyline: string;
    };
    optimizedIntermediateWaypointIndex?: number[];
  }>;
}

interface ApiResponse {
  success: boolean;
  optimizedJobs?: OptimizationJob[];
  route?: {
    duration: string;
    distance: number;
    polyline: string;
  };
  error?: string;
  details?: string;
  geocodingErrors?: Record<string, string>;
  successCount?: number;
  failureCount?: number;
}

/**
 * Get coordinates for an address using Google Geocoding API
 */
async function getCoordinates(address: string, apiKey: string): Promise<Location | null> {
  try {
    // Clean up the address by removing extra spaces
    const cleanAddress = address.trim().replace(/\s+/g, ' ');
    
    // Verify API key format
    if (!apiKey || apiKey.length < 20) {
      console.error('API Key Error: Google Maps API key appears to be invalid or too short');
      throw new Error('Google Maps API key appears to be invalid. Please check your API key.');
    }

    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
        cleanAddress
      )}&key=${apiKey}`
    );

    if (!response.ok) {
      console.error('Geocoding API error:', {
        status: response.status,
        statusText: response.statusText
      });
      throw new Error(`Geocoding request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Handle API response errors
    if (data.status === 'REQUEST_DENIED') {
      if (data.error_message?.toLowerCase().includes('expired')) {
        throw new Error('The Google Maps API key has expired.');
      } else if (data.error_message?.toLowerCase().includes('invalid')) {
        throw new Error('The Google Maps API key is invalid.');
      } else if (data.error_message?.toLowerCase().includes('not authorized')) {
        throw new Error('The Google Maps API key is not authorized for the Geocoding API.');
      } else if (data.error_message?.toLowerCase().includes('referer')) {
        throw new Error('The Google Maps API key has referer restrictions which prevent server-side API calls.');
      } else {
        throw new Error(`Geocoding request denied: ${data.error_message}`);
      }
    }

    if (data.status === 'OVER_QUERY_LIMIT') {
      throw new Error('Google Maps API quota exceeded. Please try again later or upgrade your API plan.');
    }

    if (data.status === 'OK' && data.results[0]) {
      const { lat, lng } = data.results[0].geometry.location;
      return { latitude: lat, longitude: lng };
    }

    return null;
  } catch (error) {
    if (error instanceof Error) {
      // Check if it's an API key related error
      if (error.message.includes('API key')) {
        console.error('API Key Error:', error.message);
        throw error; // Re-throw API key errors to handle them specially
      }
    }
    throw error;
  }
}

/**
 * Optimize route using Google Routes API
 */
async function optimizeRoute(jobs: OptimizationJob[], apiKey: string): Promise<ApiResponse> {
  try {
    // Filter out jobs without addresses
    const validJobs = jobs.filter(
      (job: OptimizationJob) => job.address !== null && job.address.trim() !== ''
    );
    
    if (validJobs.length < 2) {
      return {
        success: false,
        error: 'Need at least 2 valid addresses to optimize route',
        details: 'Please ensure all jobs have valid addresses',
      };
    }

    // Get coordinates for all addresses
    let geocodingSuccessCount = 0;
    let geocodingFailureCount = 0;
    const geocodingErrors: Record<string, string> = {};

    const jobsWithCoordinates: (OptimizationJob | null)[] = await Promise.all(
      validJobs.map(async (job: OptimizationJob) => {
        if (!job.address) return null;
        try {
          const coordinates = await getCoordinates(job.address, apiKey);
          if (!coordinates) {
            geocodingFailureCount++;
            geocodingErrors[job.id] = 'No coordinates returned for address';
            return null;
          }
          geocodingSuccessCount++;
          return {
            ...job,
            coordinates
          };
        } catch (error) {
          geocodingFailureCount++;
          if (error instanceof Error) {
            geocodingErrors[job.id] = error.message;
            if (error.message.includes('API key')) {
              // Propagate API key errors
              throw error;
            }
          }
          return null;
        }
      })
    );

    // Filter out any jobs where geocoding failed
    const validJobsWithCoordinates = jobsWithCoordinates.filter((job): job is OptimizationJobWithCoordinates => 
      job !== null && job.coordinates !== undefined
    );

    if (validJobsWithCoordinates.length < 2) {
      return {
        success: false,
        optimizedJobs: [],
        error: 'Failed to geocode enough addresses',
        details: 'We were unable to convert enough of your addresses into coordinates',
        geocodingErrors,
        successCount: geocodingSuccessCount,
        failureCount: geocodingFailureCount
      };
    }

    const firstJob = validJobsWithCoordinates[0];
    const lastJob = validJobsWithCoordinates[validJobsWithCoordinates.length - 1];

    // Call Google Routes API
    const routesResponse = await fetch(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.optimizedIntermediateWaypointIndex'
        },
        body: JSON.stringify({
          origin: {
            location: {
              latLng: {
                latitude: firstJob.coordinates.latitude,
                longitude: firstJob.coordinates.longitude
              }
            }
          },
          destination: {
            location: {
              latLng: {
                latitude: lastJob.coordinates.latitude,
                longitude: lastJob.coordinates.longitude
              }
            }
          },
          intermediates: validJobsWithCoordinates.slice(1, -1).map(job => ({
            location: {
              latLng: {
                latitude: job.coordinates.latitude,
                longitude: job.coordinates.longitude
              }
            }
          })),
          travelMode: "DRIVE",
          optimizeWaypointOrder: true,
          computeAlternativeRoutes: false,
          routeModifiers: {
            avoidTolls: false,
            avoidHighways: false,
            avoidFerries: false
          },
          languageCode: "en-US",
          units: "IMPERIAL"
        })
      }
    );

    if (!routesResponse.ok) {
      const errorData = await routesResponse.json().catch(() => ({}));
      
      // Check for API key related errors
      if (errorData.error?.status === 'PERMISSION_DENIED' || 
          errorData.error?.message?.includes('API key') || 
          errorData.error?.message?.includes('permission')) {
        throw new Error('The Google Maps API key is not authorized for the Routes API.');
      }
      
      throw new Error(
        errorData.error?.message || 
        `Failed to optimize route: ${routesResponse.status} ${routesResponse.statusText}`
      );
    }

    const routesData = await routesResponse.json() as RouteResponse;
    
    if (!routesData.routes?.[0]) {
      throw new Error('No route found');
    }

    // Process the optimized route
    const optimizedRoute = routesData.routes[0];
    
    // Get the optimized order of jobs
    const optimizedJobs = [firstJob];
    const intermediateJobs = validJobsWithCoordinates.slice(1, -1);
    
    // Add intermediate jobs in optimized order
    if (optimizedRoute.optimizedIntermediateWaypointIndex && optimizedRoute.optimizedIntermediateWaypointIndex.length > 0) {
      optimizedRoute.optimizedIntermediateWaypointIndex.forEach((index: number) => {
        if (intermediateJobs[index]) {
          optimizedJobs.push(intermediateJobs[index]);
        }
      });
    } else {
      optimizedJobs.push(...intermediateJobs);
    }
    
    // Add the destination job
    optimizedJobs.push(lastJob);

    return {
      success: true,
      optimizedJobs,
      route: {
        duration: optimizedRoute.duration,
        distance: optimizedRoute.distanceMeters,
        polyline: optimizedRoute.polyline.encodedPolyline
      }
    };
  } catch (error) {
    // Handle API key related errors with more helpful messages
    if (error instanceof Error) {
      if (error.message.includes('API key')) {
        // API key related error
        return {
          success: false,
          optimizedJobs: [],
          error: 'Google Maps API Configuration Error',
          details: error.message
        };
      }
    }

    return {
      success: false,
      optimizedJobs: [],
      error: 'Failed to optimize route',
      details: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export async function POST(req: NextRequest) {
  try {
    // Parse the request body
    const { jobs, apiKey } = await req.json();

    // Check if API key is provided in request body
    if (!apiKey) {
      // Fall back to environment variable if not in request
      const envApiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY_ROUTES_RP;
      
      if (!envApiKey) {
        console.error('API Key Error: Google Maps API key is not configured');
        return NextResponse.json(
          { 
            success: false, 
            error: 'Google Maps API key is not configured',
            details: 'Please provide an API key in the request or set NEXT_PUBLIC_GOOGLE_API_KEY_ROUTES_RP in your environment variables'
          },
          { status: 500 }
        );
      }
    }

    if (!jobs || !Array.isArray(jobs)) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid request data', 
          details: 'Jobs array is required' 
        },
        { status: 400 }
      );
    }

    // Use the API key from request body or environment variable
    const googleApiKey = apiKey || process.env.NEXT_PUBLIC_GOOGLE_API_KEY_ROUTES_RP;
    
    // Optimize the route
    const result = await optimizeRoute(jobs, googleApiKey);
    
    // Return the result
    return NextResponse.json(
      result,
      { 
        status: result.success ? 200 : 400 
      }
    );
  } catch (error) {
    console.error('Error optimizing route:', {
      error,
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });

    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to optimize route', 
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 