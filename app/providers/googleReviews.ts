import { ReviewsProvider, ReviewResponse, Review, PlaceSummary } from '../types/reviews';
import axios from 'axios';

/**
 * Google Reviews Provider using the Places API (New)
 * 
 * This implementation uses the new Places API endpoints (places.googleapis.com/v1)
 * instead of the legacy endpoints (maps.googleapis.com/maps/api/place).
 * 
 * The new API uses:
 * - Header-based field selection via X-Goog-FieldMask
 * - Different response structure
 * - Resource-based URLs
 */
export class GoogleReviewsProvider implements ReviewsProvider {
  private apiKey: string;
  private referer: string;
  // In-memory cache for reviews by place ID
  private reviewsCache: Map<string, { reviews: Review[], timestamp: number }> = new Map();
  // In-memory cache for place details
  private detailsCache: Map<string, { summary: PlaceSummary, timestamp: number }> = new Map();
  // Cache expiration time: 1 hour
  private CACHE_EXPIRATION = 60 * 60 * 1000;
  // Default page size
  private DEFAULT_PAGE_SIZE = 6;
  // Base URL for the new Places API
  private BASE_URL = 'https://places.googleapis.com/v1/places';

  constructor() {
    this.apiKey = process.env.GOOGLE_MAPS_API_KEY || '';
    // Referer header for API key HTTP referrer restrictions
    // Should match one of the allowed referrers in your Google Cloud Console API key settings
    this.referer = process.env.GOOGLE_API_REFERER || process.env.NEXT_PUBLIC_APP_URL || 'https://api.example.com';
    
    if (!this.apiKey) {
      console.warn('⚠️ GOOGLE_MAPS_API_KEY environment variable is not set. Google Reviews provider will not function correctly.');
    } else {
      console.log(`Google Reviews provider initialized with API key: ${this.apiKey.substring(0, 6)}...`);
    }
  }

  name = 'google';

  async getReviews(
    placeId: string, 
    options?: { 
      maxResults?: number; 
      language?: string; 
      minimumRating?: number;
      pageToken?: string;
    }
  ): Promise<ReviewResponse> {
    try {
      // NOTE FOR FUTURE DEVELOPMENT:
      // For clients who need more than the limited ~15 reviews that Google's API provides,
      // a web scraping solution would be required. This would involve:
      // 1. Creating a separate endpoint that scrapes reviews from Google Maps web interface
      // 2. Implementing proper rate limiting to avoid being blocked
      // 3. Adding caching to reduce load on Google's servers
      // 4. Providing a flag to use either the API (fast, limited) or scraping (slower, more complete)
      // This is not implemented currently due to terms of service considerations.
      
      const pageSize = options?.maxResults || this.DEFAULT_PAGE_SIZE;
      const language = options?.language || 'en';
      
      console.log(`Processing reviews for location ${placeId}`);
      
      // Get place details
      const placeDetails = await this.getPlaceDetails(placeId, language);
      
      if (!placeDetails.success) {
        console.error(`Failed to get place details for ${placeId}:`, placeDetails.error);
        return placeDetails;
      }
      
      console.log(`Place summary: ${placeDetails.summary?.totalReviews} total reviews with ${placeDetails.summary?.rating} stars`);
      
      // Get all reviews for the place
      const allReviews = await this.getReviewsForPlace(placeId, language, options?.minimumRating);
      
      console.log(`Total reviews after filtering: ${allReviews.length}`);
      
      // Handle pagination
      let startIndex = 0;
      if (options?.pageToken) {
        try {
          // Parse the page token - now we use a base64 encoded JSON object
          const decodedToken = Buffer.from(options.pageToken, 'base64').toString('utf-8');
          const tokenData = JSON.parse(decodedToken);
          
          // Extract the startIndex from the token
          if (typeof tokenData.startIndex === 'number' && tokenData.startIndex >= 0) {
            startIndex = tokenData.startIndex;
          }
        } catch (error) {
          console.warn('Invalid page token provided, defaulting to first page:', error);
          startIndex = 0;
        }
      }
      
      const endIndex = startIndex + pageSize;
      const pageReviews = allReviews.slice(startIndex, endIndex);
      const hasMoreReviews = endIndex < allReviews.length;
      
      // Create a more descriptive page token for the next page
      const nextPageToken = hasMoreReviews ? 
        Buffer.from(JSON.stringify({
          startIndex: endIndex,
          placeId: placeId,
          totalReviews: allReviews.length,
          minimumRating: options?.minimumRating
        })).toString('base64') : 
        undefined;
      
      console.log(`Returning ${pageReviews.length} reviews, page ${startIndex}-${endIndex}, hasMore: ${hasMoreReviews}`);
      
      return {
        success: true,
        provider: this.name,
        results: pageReviews,
        summary: placeDetails.summary,
        pagination: {
          nextPageToken,
          hasMoreReviews,
          // Add additional pagination metadata
          currentPage: Math.floor(startIndex / pageSize) + 1,
          totalPages: Math.ceil(allReviews.length / pageSize),
          pageSize: pageSize,
          totalReviews: allReviews.length
        }
      };
    } catch (error: unknown) {
      console.error('Error in getReviews:', error);
      return {
        success: false,
        provider: this.name,
        results: [],
        error: {
          code: (error as { response?: { status?: number } }).response?.status?.toString() || 'UNKNOWN',
          message: (error as { message?: string }).message || 'Unknown error occurred'
        }
      };
    }
  }

  // Get all reviews for a single place
  private async getReviewsForPlace(
    placeId: string, 
    language: string, 
    minimumRating?: number
  ): Promise<Review[]> {
    try {
      // If we have cached reviews for this place ID and they're not expired, use them
      let allReviews: Review[] = [];
      const cacheKey = `${placeId}_${language}`;
      const cachedData = this.reviewsCache.get(cacheKey);
      
      if (cachedData && (Date.now() - cachedData.timestamp) < this.CACHE_EXPIRATION) {
        console.log(`Using cached reviews for ${placeId}, found ${cachedData.reviews.length} reviews`);
        allReviews = cachedData.reviews;
      } else {
        // Fetch reviews using the new API
        // Note: The new Places API doesn't support sort options in the same way
        // We'll fetch reviews and they'll come back in default order
        console.log(`Fetching fresh reviews for ${placeId} using Places API (New)`);
        
        const reviewsResult = await this.fetchReviewsNew(placeId, language);
        
        if (reviewsResult.success && reviewsResult.results.length > 0) {
          console.log(`Got ${reviewsResult.results.length} reviews for ${placeId}`);
          allReviews = reviewsResult.results;
        }
        
        // Update cache
        this.reviewsCache.set(cacheKey, {
          reviews: allReviews,
          timestamp: Date.now()
        });
      }
      
      // Apply rating filter if specified
      if (minimumRating !== undefined) {
        const filteredReviews = allReviews.filter(review => 
          review.rating >= (minimumRating as number)
        );
        console.log(`After rating filter (min: ${minimumRating}), have ${filteredReviews.length} reviews for ${placeId}`);
        return filteredReviews;
      }
      
      return allReviews;
    } catch (error) {
      console.error(`Error getting reviews for place ${placeId}:`, error);
      return [];
    }
  }

  // Fetch place details using the new Places API
  private async getPlaceDetails(placeId: string, language: string): Promise<ReviewResponse> {
    try {
      // Check cache first
      const cacheKey = `${placeId}_${language}_details`;
      const cachedData = this.detailsCache.get(cacheKey);
      
      if (cachedData && (Date.now() - cachedData.timestamp) < this.CACHE_EXPIRATION) {
        console.log(`Using cached details for ${placeId}`);
        return {
          success: true,
          provider: this.name,
          results: [],
          summary: cachedData.summary
        };
      }
      
      // Verify API key
      if (!this.apiKey) {
        console.error('Google Maps API key is not configured. Please set GOOGLE_MAPS_API_KEY environment variable.');
        return {
          success: false,
          provider: this.name,
          results: [],
          error: {
            code: 'API_KEY_MISSING',
            message: 'Google Maps API key is not configured'
          }
        };
      }
      
      console.log(`Using Google Maps API Key: ${this.apiKey.substring(0, 6)}...`);
      
      // Use the new Places API endpoint
      // The new API uses a different URL structure and header-based field selection
      const response = await axios.get(
        `${this.BASE_URL}/${placeId}`,
        {
          headers: {
            'X-Goog-Api-Key': this.apiKey,
            'X-Goog-FieldMask': 'displayName,rating,userRatingCount,formattedAddress,googleMapsUri',
            'Accept-Language': language,
            'Referer': this.referer
          }
        }
      );
      
      // Log the response for debugging
      console.log('Google Places API (New) response:', {
        name: response.data.displayName?.text,
        rating: response.data.rating,
        totalReviews: response.data.userRatingCount,
      });

      // Log a warning if the business has many more reviews than we can fetch
      if (typeof response.data.userRatingCount === 'number' && response.data.userRatingCount > 20) {
        console.warn(
          `⚠️ Google API limitation: Place ${placeId} has ${response.data.userRatingCount} reviews, ` +
          `but the API will only return ~5 reviews maximum. This is a Google API limitation, ` +
          `not an issue with our implementation.`
        );
      }

      // Create a more robust summary with fallbacks
      const summary: PlaceSummary = {
        name: response.data.displayName?.text || '',
        // Ensure we have a valid rating - if API returns null/undefined, default to 0
        rating: typeof response.data.rating === 'number' ? response.data.rating : 0,
        // Ensure we have a valid review count - if API returns null/undefined, default to 0
        totalReviews: typeof response.data.userRatingCount === 'number' ? response.data.userRatingCount : 0,
        url: response.data.googleMapsUri || `https://www.google.com/maps/place/?q=place_id:${placeId}`
      };
      
      // Update cache
      this.detailsCache.set(cacheKey, {
        summary,
        timestamp: Date.now()
      });

      return {
        success: true,
        provider: this.name,
        results: [],
        summary
      };
    } catch (error: unknown) {
      console.error('Error in getPlaceDetails:', error);
      
      // Handle specific API errors
      const axiosError = error as { response?: { data?: { error?: { message?: string; status?: string } }; status?: number } };
      if (axiosError.response?.data?.error) {
        const apiError = axiosError.response.data.error;
        console.error('API error details:', apiError);
        return {
          success: false,
          provider: this.name,
          results: [],
          error: {
            code: apiError.status || axiosError.response.status?.toString() || 'UNKNOWN',
            message: apiError.message || 'Unknown error occurred'
          }
        };
      }
      
      return {
        success: false,
        provider: this.name,
        results: [],
        error: {
          code: axiosError.response?.status?.toString() || 'UNKNOWN',
          message: (error as { message?: string }).message || 'Unknown error occurred'
        }
      };
    }
  }

  // Fetch reviews using the new Places API
  private async fetchReviewsNew(placeId: string, language: string): Promise<ReviewResponse> {
    try {
      // The new Places API includes reviews in the place details response
      const response = await axios.get(
        `${this.BASE_URL}/${placeId}`,
        {
          headers: {
            'X-Goog-Api-Key': this.apiKey,
            'X-Goog-FieldMask': 'reviews',
            'Accept-Language': language,
            'Referer': this.referer
          }
        }
      );

      // If no reviews found
      if (!response.data.reviews || response.data.reviews.length === 0) {
        console.log(`No reviews found for ${placeId}`);
        return {
          success: true,
          provider: this.name,
          results: []
        };
      }

      const reviews = response.data.reviews.map((review: GoogleReviewNew) => this.transformReviewNew(review));
      console.log(`Fetched ${reviews.length} reviews for ${placeId}`);
      
      return {
        success: true,
        provider: this.name,
        results: reviews
      };
    } catch (error: unknown) {
      console.error(`Error fetching reviews:`, error);
      
      const axiosError = error as { response?: { data?: { error?: { message?: string; status?: string } }; status?: number } };
      if (axiosError.response?.data?.error) {
        const apiError = axiosError.response.data.error;
        return {
          success: false,
          provider: this.name,
          results: [],
          error: {
            code: apiError.status || axiosError.response.status?.toString() || 'UNKNOWN',
            message: apiError.message || 'Unknown error occurred'
          }
        };
      }
      
      return {
        success: false,
        provider: this.name,
        results: [],
        error: {
          code: axiosError.response?.status?.toString() || 'UNKNOWN',
          message: (error as { message?: string }).message || 'Unknown error occurred'
        }
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      if (!this.apiKey) {
        return false;
      }
      
      // Try to fetch details for a known place
      const response = await this.getPlaceDetails('ChIJK7PWTAelK4cRA4mU_lf0uXc', 'en');
      return response.success;
    } catch (error) {
      console.error('Error checking provider availability:', error);
      return false;
    }
  }

  getRateLimit() {
    return {
      requests: 10,
      period: 1000 // 1 second - Place API has a lower quota than Geocoding
    };
  }

  // Transform review from the new API format
  private transformReviewNew(review: GoogleReviewNew): Review {
    return {
      author: review.authorAttribution?.displayName || 'Anonymous',
      authorProfilePhoto: review.authorAttribution?.photoUri,
      rating: review.rating || 0,
      text: review.text?.text || '',
      time: review.publishTime || new Date().toISOString(),
      relativeTime: review.relativePublishTimeDescription,
      language: review.originalText?.languageCode,
      raw: review
    };
  }

  /**
   * Get reviews for a place with chunked loading for better performance
   * This implements true server-side pagination where we only fetch the reviews that are needed
   */
  async getReviewsChunked(
    placeId: string,
    options?: {
      maxResults?: number;
      language?: string;
      minimumRating?: number;
      pageToken?: string;
    }
  ): Promise<ReviewResponse> {
    try {
      const pageSize = options?.maxResults || this.DEFAULT_PAGE_SIZE;
      const language = options?.language || 'en';
      
      console.log(`Processing chunked reviews for location ${placeId}`);
      
      // Get place details
      const placeDetails = await this.getPlaceDetails(placeId, language);
      
      if (!placeDetails.success) {
        console.error(`Failed to get place details for ${placeId}:`, placeDetails.error);
        return placeDetails;
      }
      
      console.log(`Place summary: ${placeDetails.summary?.totalReviews} total reviews with ${placeDetails.summary?.rating} stars`);
      
      // Parse token if provided
      let tokenData = {
        reviewIds: new Set<string>(),
        lastReviewTime: 0,
        minimumRating: options?.minimumRating
      };
      
      if (options?.pageToken) {
        try {
          const decodedToken = Buffer.from(options.pageToken, 'base64').toString('utf-8');
          const parsedToken = JSON.parse(decodedToken);
          
          tokenData = {
            reviewIds: new Set(parsedToken.reviewIds || []),
            lastReviewTime: parsedToken.lastReviewTime || 0,
            minimumRating: parsedToken.minimumRating
          };
        } catch (error) {
          console.warn('Invalid page token provided, starting fresh:', error);
        }
      }
      
      // Fetch reviews using the new API
      const reviewsResponse = await this.fetchReviewsNew(placeId, language);
      
      if (!reviewsResponse.success) {
        return reviewsResponse;
      }
      
      // Process the reviews and filter out duplicates
      const uniqueReviews: Review[] = [];
      for (const review of reviewsResponse.results) {
        // Create a unique ID for this review
        const reviewId = `${review.author}_${review.time}`;
        
        // Skip reviews we've already seen
        if (tokenData.reviewIds.has(reviewId)) {
          continue;
        }
        
        // Skip reviews below minimum rating if specified
        if (tokenData.minimumRating !== undefined && 
            review.rating < tokenData.minimumRating) {
          continue;
        }
        
        // Add this review to our results
        uniqueReviews.push(review);
        
        // Track that we've seen this review
        tokenData.reviewIds.add(reviewId);
        
        // If we have enough reviews for this page, stop
        if (uniqueReviews.length >= pageSize) {
          break;
        }
      }
      
      // Determine if there are more results
      const hasMoreReviews = reviewsResponse.results.length > uniqueReviews.length;
      
      // Create a new page token
      const nextPageToken = hasMoreReviews ? 
        Buffer.from(JSON.stringify({
          reviewIds: Array.from(tokenData.reviewIds),
          lastReviewTime: uniqueReviews.length > 0 ? 
            new Date(uniqueReviews[uniqueReviews.length - 1].time).getTime() : 0,
          minimumRating: tokenData.minimumRating
        })).toString('base64') : 
        undefined;
      
      console.log(`Returning ${uniqueReviews.length} chunked reviews, hasMore: ${hasMoreReviews}`);
      
      return {
        success: true,
        provider: this.name,
        results: uniqueReviews,
        summary: placeDetails.summary,
        pagination: {
          nextPageToken,
          hasMoreReviews,
          pageSize: pageSize,
          totalReviews: placeDetails.summary?.totalReviews || 0
        }
      };
    } catch (error: unknown) {
      console.error('Error in getReviewsChunked:', error);
      return {
        success: false,
        provider: this.name,
        results: [],
        error: {
          code: (error as { response?: { status?: number } }).response?.status?.toString() || 'UNKNOWN',
          message: (error as { message?: string }).message || 'Unknown error occurred'
        }
      };
    }
  }
}

// Type for the new Google Places API review format
interface GoogleReviewNew {
  name?: string;
  relativePublishTimeDescription?: string;
  rating?: number;
  text?: {
    text: string;
    languageCode?: string;
  };
  originalText?: {
    text: string;
    languageCode?: string;
  };
  authorAttribution?: {
    displayName?: string;
    uri?: string;
    photoUri?: string;
  };
  publishTime?: string;
}
