import { NextRequest, NextResponse } from 'next/server';

// Constants
const WAREHOUSE_LOCATION = { lat: 33.3434174, lng: -111.8392013 };
// Maricopa zipcodes and any others that needs to be excluded
const EXCLUDED_ZIPCODES = [
    85138,
    85139,
    85172,
    85122,
    85130,
    85193,
    85194,
]

// Get allowed API keys from environment
const ALLOWED_API_KEYS = process.env.ALLOWED_API_KEYS?.split(',') || [];

// Utility functions
function calculateDeliveryCost(distance: number): number | 'Outside of delivery range' {
    if (distance <= 15) {
        return 120.00;
    } else if (distance <= 30) {
        const theCost = distance * 8;
        return Math.round(theCost * 100) / 100;
    }
    return 'Outside of delivery range';
}

export async function POST(req: NextRequest) {
    // Check for API key in headers
    const apiKey = req.headers.get('x-api-key');
    
    if (!apiKey || !ALLOWED_API_KEYS.includes(apiKey)) {
        console.log('API Key Authentication Failed:', {
            receivedKey: apiKey
        });
        
        return new NextResponse(JSON.stringify({ 
            error: 'Unauthorized - Invalid API key'
        }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // Log successful API usage
    console.log(`Authorized API request received`);

    const googleMapsApiKey = process.env.ROYALTY_RENTALS_GOOGLE_MAPS_API_KEY;
    if (!googleMapsApiKey) {
        return new NextResponse(JSON.stringify({ error: 'Configuration error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        const { customerAddress } = await req.json();
        if (!customerAddress) {
            return new NextResponse(JSON.stringify({ error: 'Customer address not provided' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Maricopa exclusion logic for both string and object address
        let isMaricopa = false;
        if (typeof customerAddress === 'object' && customerAddress !== null) {
            isMaricopa = (
                customerAddress.city === "Maricopa" ||
                EXCLUDED_ZIPCODES.map(String).includes(String(customerAddress.postcode).trim())
            );
        } else if (typeof customerAddress === 'string') {
            const lowerAddress = customerAddress.toLowerCase();
            isMaricopa = lowerAddress.includes('maricopa') ||
                EXCLUDED_ZIPCODES.map(String).some(zip => lowerAddress.includes(zip));
        }
        if (isMaricopa) {
            return new NextResponse(JSON.stringify({
                deliveryCost: 0.0 ,
                noDelivery: true,
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Format address
        const formattedAddress = typeof customerAddress === 'string' 
            ? customerAddress 
            : `${customerAddress.address_1}, ${customerAddress.city}, ${customerAddress.state} ${customerAddress.postcode}`;

        // Geocode address
        const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(formattedAddress)}&key=${googleMapsApiKey}`;
        const geocodeResponse = await fetch(geocodeUrl);
        const geocodeData = await geocodeResponse.json();

        if (geocodeData.status !== 'OK' || !geocodeData.results?.[0]) {
            return new NextResponse(JSON.stringify({ error: 'Invalid address or geocoding error' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Calculate route
        const customerLocation = geocodeData.results[0].geometry.location;
        const routeUrl = 'https://routes.googleapis.com/directions/v2:computeRoutes';
        const routeResponse = await fetch(routeUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': googleMapsApiKey,
                'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters'
            },
            body: JSON.stringify({
                origin: {
                    location: {
                        latLng: {
                            latitude: WAREHOUSE_LOCATION.lat,
                            longitude: WAREHOUSE_LOCATION.lng
                        }
                    }
                },
                destination: {
                    location: {
                        latLng: {
                            latitude: customerLocation.lat,
                            longitude: customerLocation.lng
                        }
                    }
                },
                travelMode: "DRIVE",
                routingPreference: "TRAFFIC_UNAWARE",
                computeAlternativeRoutes: false,
                languageCode: "en-US",
                units: "IMPERIAL"
            })
        });

        const routeData = await routeResponse.json();
        if (!routeResponse.ok || !routeData.routes?.[0]) {
            return new NextResponse(JSON.stringify({ error: 'Error calculating route' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Calculate delivery cost
        const distanceInMiles = routeData.routes[0].distanceMeters / 1609.34;
        const cost = calculateDeliveryCost(distanceInMiles);

        return new NextResponse(JSON.stringify({
            deliveryCost: cost === 'Outside of delivery range' ? 0.0 : parseFloat(cost.toFixed(2)),
            noDelivery: cost === 'Outside of delivery range',
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error: unknown) {
        console.error('Error processing request:', error);
        return new NextResponse(JSON.stringify({ error: 'Internal server error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
} 