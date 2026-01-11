# Geocoding Service

A Next.js-based geocoding service that provides a unified API for geocoding addresses using various providers (currently supporting Google Maps and US Census Bureau).

## Features

- Address geocoding with multiple provider support
- **Cost-optimized geocoding** - Automatically uses free US Census geocoding for US addresses, falls back to Google for international addresses
- Batch geocoding support for up to 10,000 addresses at once
- Google Place Reviews retrieval
- Place search functionality
- API key authentication
- Edge runtime support
- TypeScript support
- Input validation
- Error handling

## Setup

1. Clone the repository
2. Install dependencies:
```bash
bun install
```

3. Create a `.env` file with the following variables:
```env
# Google Maps API Key for geocoding
GOOGLE_MAPS_API_KEY=your_google_maps_api_key

# Google Maps API Key for Royalty Rentals distance calculations
ROYALTY_RENTALS_GOOGLE_MAPS_API_KEY=your_royalty_rentals_google_maps_api_key

# Comma-separated list of allowed API keys
ALLOWED_API_KEYS=your_api_key_1,your_api_key_2
```

4. Run the development server:
```bash
bun run dev
```

## Authentication

All API endpoints require an API key to be included in the request headers:

```
X-API-Key: your_api_key
```

The API key must match one of the keys specified in the `ALLOWED_API_KEYS` environment variable. Requests without a valid API key will receive a 401 Unauthorized response.

## API Endpoints

### POST /api/v1/geocode

Geocodes an address using the specified provider.

**Headers:**
```
X-API-Key: your_api_key
Content-Type: application/json
```

**Request Body:**
```json
{
  "address": "1600 Amphitheatre Parkway, Mountain View, CA",
  "provider": "census", // optional: "census", "google", or omit for automatic provider selection
  "options": { // optional
    "country": "US",
    "language": "en",
    "bounds": {
      "northeast": { "lat": 37.4, "lng": -122.0 },
      "southwest": { "lat": 37.3, "lng": -122.1 }
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "provider": "census",
  "results": [
    {
      "latitude": 37.4224764,
      "longitude": -122.0842499,
      "formattedAddress": "1600 Amphitheatre Parkway, Mountain View, CA 94043, USA",
      "confidence": 0.9,
      "components": {
        "street": "Amphitheatre Parkway",
        "city": "Mountain View",
        "state": "California",
        "country": "United States",
        "postalCode": "94043"
      }
    }
  ]
}
```

### Provider Selection

The geocoding service automatically selects the most cost-effective provider:

1. **US Census (Free)** - Used first for addresses that appear to be in the United States
2. **Google Maps (Paid)** - Used as fallback for international addresses or when Census fails

You can override this behavior by specifying a `provider` in your request:
- `"census"` - Use US Census only (will fail for non-US addresses)
- `"google"` - Use Google Maps only
- Omit provider field - Automatic provider selection (recommended)

### Batch Geocoding

For processing large numbers of addresses efficiently, you can use the Census batch geocoding utility directly in your application code:

```typescript
import { submitBatchGeocode, processLargeBatch } from '@/app/lib/census-batch';

// Process up to 10,000 addresses at once
const addresses = [
  { id: '1', street: '1600 Amphitheatre Parkway', city: 'Mountain View', state: 'CA', zip: '94043' },
  { id: '2', street: '1 Apple Park Way', city: 'Cupertino', state: 'CA', zip: '95014' },
  // ... more addresses
];

const results = await submitBatchGeocode(addresses);

// For more than 10,000 addresses, use processLargeBatch
const largeResults = await processLargeBatch(addresses, 10000);
```

**Benefits of batch geocoding:**
- **Free** - US Census batch geocoding is completely free
- **Efficient** - Process up to 10,000 addresses in a single request
- **Reliable** - Based on official TIGER/Line database from US Census Bureau
- **No rate limits** - Unlike Google's API, no per-second request limits

### POST /api/v1/reviews

Retrieves Google reviews for a specific place using its place ID.

**Headers:**
```
X-API-Key: your_api_key
Content-Type: application/json
```

**Request Body:**
```json
{
  "placeId": "ChIJj61dQgK6j4AR4GeTYWZsKWw",
  "maxResults": 6, // optional, default is 6 reviews per page
  "language": "en", // optional, default is "en"
  "minimumRating": 5, // optional, filters reviews by rating (1-5)
  "pageToken": "base64-token", // optional, used for pagination
  "chunked": true // optional, enables chunked loading
}
```

**Response:**
```json
{
  "success": true,
  "provider": "google",
  "results": [
    {
      "author": "John Doe",
      "authorProfilePhoto": "https://lh3.googleusercontent.com/a/profile-photo-url",
      "rating": 5,
      "text": "Great service and friendly staff!",
      "time": "2023-06-15T14:30:00.000Z",
      "relativeTime": "2 months ago",
      "language": "en"
    },
    // ... more reviews
  ],
  "summary": {
    "name": "Business Name",
    "rating": 4.7,
    "totalReviews": 1138,
    "url": "https://maps.google.com/?cid=..."
  },
  "pagination": {
    "nextPageToken": "base64-token",
    "hasMoreReviews": true,
    "currentPage": 1,
    "totalPages": 10,
    "pageSize": 6,
    "totalReviews": 57
  }
}
```

### Pagination Options

The reviews endpoint offers two pagination approaches:

#### 1. Standard Pagination (Default)
- Loads all reviews for a place, then applies client-side pagination
- Better for places with fewer reviews (less than 100)
- Provides accurate totalPages and totalReviews counts
- Faster for subsequent page requests since all data is already loaded

**Usage:**
```json
{
  "placeId": "ChIJj61dQgK6j4AR4GeTYWZsKWw",
  "maxResults": 10,
  "pageToken": "optional-token-from-previous-response"
}
```

#### 2. Chunked Loading
- Loads reviews on-demand, fetching only what's needed for each page
- Better for places with many reviews (100+)
- Faster initial loading time
- Optimized for mobile and bandwidth-constrained scenarios

**Usage:**
```json
{
  "placeId": "ChIJj61dQgK6j4AR4GeTYWZsKWw",
  "maxResults": 10,
  "chunked": true,
  "pageToken": "optional-token-from-previous-response"
}
```

You can also enable chunked loading via URL parameter:
```
POST /api/v1/reviews?chunked=true
```

### Google API Limitations for Reviews

**Important:** The Google Places API has significant limitations regarding review retrieval:

- **Maximum 5 reviews per request**: Each API call returns at most 5 reviews
- **No official pagination**: Unlike other Google APIs, there is no way to request "the next 5 reviews"
- **Limited sorting options**: Only 3 sort methods are available: most_relevant, newest, and highest_rating

Our service attempts to work around these limitations by:
1. Making multiple requests with different sort methods
2. Deduplicating the results
3. Providing our own pagination on top of the combined results

**However, even with these optimizations, you can only retrieve about 10-15 unique reviews per place, regardless of how many actual reviews exist.** This is a limitation of Google's API, not our implementation.

For businesses with hundreds of reviews, the API will still report the correct total count in the `summary.totalReviews` field, but you'll only be able to access a small subset of the most recent or most relevant reviews.

### Implementing Pagination

To implement "load more" functionality:

1. Make the initial request without a `pageToken`
2. If `pagination.hasMoreReviews` is `true`, you can make another request with `pageToken` set to the value of `pagination.nextPageToken` to get the next set of reviews
3. Repeat until `pagination.hasMoreReviews` is `false`

The pageToken is a base64-encoded string containing metadata about the page request, including:
- The starting index for the next page
- Information about which reviews have already been seen
- The current sort method being used

**Note:** To get a Google Place ID, you can use the [Google Places API Place ID Finder](https://developers.google.com/maps/documentation/places/web-service/place-id).

**Error Responses:**
- 401: Unauthorized - Invalid API key
- 400: Invalid request or missing required field
- 503: Provider not available
- 500: Internal server error

### GET /api/v1/health

Returns the health status of the service and its providers.

**Headers:**
```
X-API-Key: your_api_key
```

**Response:**
```json
{
  "status": "ok",
  "providers": {
    "google-geocoding": true,
    "google-reviews": true
  },
  "timestamp": "2024-02-21T12:00:00.000Z"
}
```

### POST /api/v1/distance

Calculates delivery cost based on the distance between a warehouse location and a customer address for Royalty Rentals.

**Headers:**
```
X-API-Key: your_api_key
Content-Type: application/json
```

**Request Body:**
```json
{
  "customerAddress": "1234 Example St, Phoenix, AZ 85001"
}
```
OR
```json
{
  "customerAddress": {
    "address_1": "1234 Example St",
    "city": "Phoenix",
    "state": "AZ",
    "postcode": "85001"
  }
}
```

**Response:**
```json
{
  "deliveryCost": 120.00,
  "noDelivery": false
}
```

**Delivery Cost Rules:**
- Distance ≤ 15 miles: Fixed rate of $120.00
- Distance > 15 and ≤ 30 miles: $8.00 per mile
- Distance > 30 miles: No delivery available (returns `noDelivery: true` and `deliveryCost: 0.0`)

**Error Responses:**
- 401: Unauthorized - Invalid API key
- 400: Invalid address or missing customer address
- 500: Internal server error or configuration error

## Place ID Search

The service provides an API endpoint to search for Google Place IDs using various parameters:

- Business name
- City
- Phone number
- CID (Client ID from Google Maps URL)
- Exact coordinates (latitude/longitude)
- Autocomplete search option

### API Usage

```
POST /api/v1/place-search
Content-Type: application/json
x-api-key: your_api_key

{
  "name": "Starbucks",
  "city": "Seattle",
  "phone": "(123) 456-7890",
  "cid": "12345678901234567890",
  "latitude": 47.6062095,
  "longitude": -122.3320708,
  "useAutocomplete": true
}
```

At least one of the parameters must be provided. The response will include an array of candidate places with their place IDs:

```json
{
  "status": "OK",
  "candidates": [
    {
      "place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
      "name": "Starbucks",
      "formatted_address": "123 Main St, Seattle, WA 98101, USA",
      "geometry": {
        "location": {
          "lat": 47.6062095,
          "lng": -122.3320708
        }
      },
      "types": ["cafe", "food", "point_of_interest", "establishment"]
    }
  ]
}
```

### Search Logic

The endpoint employs a sophisticated search strategy using multiple Google APIs:

1. If coordinates are provided, it searches by exact location first
2. If a CID is provided, it attempts to find the place by CID
3. If a business name is provided with `useAutocomplete: true`, it uses the Places Autocomplete API
4. If a phone number is provided, it performs a specialized phone search
5. As a fallback, it uses the standard Find Place API with any available parameters

This multi-layered approach maximizes the chances of finding the correct place ID.

### Error Responses
- 401: Unauthorized - Invalid API key
- 400: Invalid request or missing search parameters
- 500: Internal server error or Google API error

## Error Handling

The service returns appropriate HTTP status codes and error messages:
- 401: Unauthorized - Invalid API key
- 400: Invalid request or provider not found
- 503: Provider not available
- 500: Internal server error

## Development

The service is built with:
- Next.js 14
- TypeScript
- Google Maps Geocoding API
- Google Places API
- Zod for request validation

## License

MIT

## Google Business Profile API Integration

The service provides API endpoints to access Google Business Profile (formerly Google My Business) data through OAuth authentication, allowing you to retrieve place IDs for all your managed business locations with a single authorization.

### OAuth Authentication

#### GET /api/v1/business-profiles/oauth

Generates an authorization URL to start the OAuth flow.

**Headers:**
```
X-API-Key: your_api_key
```

**Response:**
```json
{
  "success": true,
  "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?..."
}
```

#### POST /api/v1/business-profiles/oauth

Exchange authorization code for tokens or refresh an access token.

**Headers:**
```
X-API-Key: your_api_key
Content-Type: application/json
```

**Request Body (Exchange Code):**
```json
{
  "code": "4/P7q7W91a-oMsCeLvIaQm6bTrgtp7"
}
```

**Request Body (Refresh Token):**
```json
{
  "refresh_token": "1//xEoDL4iW3cxlI7yDbSRFYNG01kVKM2C-259HOF2aQbI"
}
```

**Response:**
```json
{
  "success": true,
  "tokens": {
    "access_token": "ya29.a0AVvZVsrf4xc-zr...truncated",
    "refresh_token": "1//xEoDL4iW3cxlI7y...truncated",
    "scope": "https://www.googleapis.com/auth/business.manage",
    "token_type": "Bearer",
    "expiry_date": 1616085134885
  }
}
```

### Business Profiles Endpoints

#### POST /api/v1/business-profiles/list

Lists all business locations that the authenticated user has access to.

**Headers:**
```
X-API-Key: your_api_key
Content-Type: application/json
```

**Request Body:**
```json
{
  "access_token": "ya29.a0AVvZVsrf4xc-zr...truncated",
  "account_id": "accounts/12345678910", // Optional, to list locations from a specific account
  "page_size": 50, // Optional, defaults to 100
  "page_token": "next_page_token_value" // Optional, for pagination
}
```

**Response:**
```json
{
  "success": true,
  "provider": "google-business-profile",
  "locations": [
    {
      "place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
      "name": "Business Name",
      "formatted_address": "123 Main St, City, State ZIP",
      "address": {
        "street": "123 Main St",
        "city": "City",
        "state": "State",
        "postalCode": "ZIP",
        "country": "US",
        "formattedAddress": "123 Main St, City, State ZIP"
      },
      "coordinates": {
        "latitude": 37.4224764,
        "longitude": -122.0842499
      },
      "phone": "(123) 456-7890",
      "website": "https://example.com",
      "account": {
        "id": "accounts/12345678910",
        "name": "My Business Account"
      },
      "service_area": {
        "businessType": "CUSTOMER_LOCATION_ONLY"
      },
      "business_type": "STOREFRONT",
      "categories": [
        {
          "displayName": "Restaurant",
          "categoryId": "gcid:restaurant"
        }
      ]
    }
  ],
  "totalCount": 10,
  "nextPageToken": "token_for_next_page" // Only present if there are more results
}
```

#### POST /api/v1/business-profiles/details

Retrieves detailed information about a specific business location.

**Headers:**
```
X-API-Key: your_api_key
Content-Type: application/json
```

**Request Body:**
```json
{
  "access_token": "ya29.a0AVvZVsrf4xc-zr...truncated",
  "location_name": "accounts/12345678910/locations/1234567891011121314"
}
```

**Response:**
```json
{
  "success": true,
  "provider": "google-business-profile",
  "location": {
    // Same structure as in the list response, but for a single location
    "place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
    "name": "Business Name",
    "formatted_address": "123 Main St, City, State ZIP",
    // ... other fields
  }
}
```

### Error Responses:
- 401: Unauthorized - Invalid API key
- 400: Invalid request or missing required fields
- 500: Internal server error or Google API error
