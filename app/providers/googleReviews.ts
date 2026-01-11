import { ReviewsProvider, ReviewResponse, Review, PlaceSummary } from '../types/reviews';
import axios from 'axios';

export class GoogleReviewsProvider implements ReviewsProvider {
  private apiKey: string;
  // In-memory cache for reviews by place ID
  private reviewsCache: Map<string, { reviews: Review[], timestamp: number }> = new Map();
  // In-memory cache for place details
  private detailsCache: Map<string, { summary: PlaceSummary, timestamp: number }> = new Map();
  // Cache expiration time: 1 hour
  private CACHE_EXPIRATION = 60 * 60 * 1000;
  // Default page size
  private DEFAULT_PAGE_SIZE = 6;

  constructor() {
    this.apiKey = process.env.GOOGLE_MAPS_API_KEY || '';
    
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
        // Otherwise, fetch reviews using multiple sort options to get more
        console.log(`Fetching fresh reviews for ${placeId} using multiple methods`);
        const reviewPromises = [
          this.fetchReviewsWithSort(placeId, language, 'most_relevant'),
          this.fetchReviewsWithSort(placeId, language, 'newest'),
          this.fetchReviewsWithSort(placeId, language, 'highest_rating')
        ];
        
        const reviewResults = await Promise.all(reviewPromises);
        
        // Log how many reviews we got from each sort option
        reviewResults.forEach((result, index) => {
          const sortMethod = ['most_relevant', 'newest', 'highest_rating'][index];
          console.log(`Got ${result.results.length} reviews from ${sortMethod} sort for ${placeId}`);
        });
        
        // Combine all reviews from different sorts and deduplicate
        const combinedReviews = this.deduplicateReviews([
          ...reviewResults[0].results,
          ...reviewResults[1].results,
          ...reviewResults[2].results,
        ]);
        
        console.log(`After deduplication, have ${combinedReviews.length} unique reviews for ${placeId}`);
        
        // Update cache
        this.reviewsCache.set(cacheKey, {
          reviews: combinedReviews,
          timestamp: Date.now()
        });
        
        allReviews = combinedReviews;
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

  // Fetch place details to get overall rating and review count
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
      
      // First try with the Basic data request which often has more accurate ratings
      const basicResponse = await axios.get(
        'https://maps.googleapis.com/maps/api/place/details/json',
        {
          params: {
            place_id: placeId,
            key: this.apiKey,
            language: language,
            fields: 'name,rating,user_ratings_total,formatted_address',
          }
        }
      );
      
      // Log the response status for debugging
      console.log(`Google Places API response status: ${basicResponse.data.status}`);
      if (basicResponse.data.status !== 'OK') {
        console.error('Full error response:', basicResponse.data);
        throw new Error(`Fetching place details failed: ${basicResponse.data.status}${basicResponse.data.error_message ? ` - ${basicResponse.data.error_message}` : ''}`);
      }
      
      // Then try with more fields to get the URL
      const detailsResponse = await axios.get(
        'https://maps.googleapis.com/maps/api/place/details/json',
        {
          params: {
            place_id: placeId,
            key: this.apiKey,
            language: language,
            fields: 'url'
          }
        }
      );

      const basicResult = basicResponse.data.result;
      const detailsResult = detailsResponse.data.result;

      // Log the raw data to help with debugging
      console.log('Basic API response for place details:', {
        name: basicResult.name,
        rating: basicResult.rating,
        totalReviews: basicResult.user_ratings_total,
      });

      // Log a warning if the business has many more reviews than we can fetch
      if (typeof basicResult.user_ratings_total === 'number' && basicResult.user_ratings_total > 20) {
        console.warn(
          `⚠️ Google API limitation: Place ${placeId} has ${basicResult.user_ratings_total} reviews, ` +
          `but the API will only return ~15 reviews maximum. This is a Google API limitation, ` +
          `not an issue with our implementation.`
        );
      }

      // Create a more robust summary with fallbacks
      const summary: PlaceSummary = {
        name: basicResult.name || '',
        // Ensure we have a valid rating - if API returns null/undefined, default to 0
        rating: typeof basicResult.rating === 'number' ? basicResult.rating : 0,
        // Ensure we have a valid review count - if API returns null/undefined, default to 0
        totalReviews: typeof basicResult.user_ratings_total === 'number' ? basicResult.user_ratings_total : 0,
        url: detailsResult?.url || `https://www.google.com/maps/place/?q=place_id:${placeId}`
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

  // Fetch reviews with a specific sort option
  private async fetchReviewsWithSort(placeId: string, language: string, sortBy: string): Promise<ReviewResponse> {
    try {
      // Note: Google Places API has a hard limit of returning only 5 reviews per request
      // regardless of how many actual reviews exist for a business. There is no official
      // way to paginate through all reviews using the API.
      const response = await axios.get(
        'https://maps.googleapis.com/maps/api/place/details/json',
        {
          params: {
            place_id: placeId,
            key: this.apiKey,
            language: language,
            fields: 'reviews',
            reviews_sort: sortBy
          }
        }
      );

      if (response.data.status !== 'OK') {
        console.warn(`Fetching reviews with sort=${sortBy} failed: ${response.data.status}`);
        return {
          success: true,
          provider: this.name,
          results: []
        };
      }

      // If no reviews found
      if (!response.data.result.reviews || response.data.result.reviews.length === 0) {
        console.log(`No reviews found for ${placeId} with sort=${sortBy}`);
        return {
          success: true,
          provider: this.name,
          results: []
        };
      }

      const reviews = response.data.result.reviews.map(this.transformReview);
      console.log(`Fetched ${reviews.length} reviews with sort=${sortBy}`);
      
      return {
        success: true,
        provider: this.name,
        results: reviews
      };
    } catch (error: unknown) {
      console.error(`Error fetching reviews with sort=${sortBy}:`, error);
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

  // Remove duplicate reviews (same author and time)
  private deduplicateReviews(reviews: Review[]): Review[] {
    const seen = new Set<string>();
    return reviews.filter(review => {
      const key = `${review.author}_${review.time}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      if (!this.apiKey) {
        return false;
      }
      
      // Try to fetch details for a known place (using one of your test IDs)
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private transformReview(review: any) {
    return {
      author: review.author_name,
      authorProfilePhoto: review.profile_photo_url,
      rating: review.rating,
      text: review.text,
      time: new Date(review.time * 1000).toISOString(),
      relativeTime: review.relative_time_description,
      language: review.language,
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
        sortMethod: 'most_relevant',
        fetchedMethods: [] as string[],
        reviewIds: new Set<string>(),
        lastReviewTime: 0,
        minimumRating: options?.minimumRating
      };
      
      if (options?.pageToken) {
        try {
          const decodedToken = Buffer.from(options.pageToken, 'base64').toString('utf-8');
          const parsedToken = JSON.parse(decodedToken);
          
          tokenData = {
            sortMethod: parsedToken.sortMethod || 'most_relevant',
            fetchedMethods: parsedToken.fetchedMethods || [],
            reviewIds: new Set(parsedToken.reviewIds || []),
            lastReviewTime: parsedToken.lastReviewTime || 0,
            minimumRating: parsedToken.minimumRating
          };
        } catch (error) {
          console.warn('Invalid page token provided, starting fresh:', error);
        }
      }
      
      // Determine which sort method to use next based on what's been fetched
      const allSortMethods = ['most_relevant', 'newest', 'highest_rating'];
      let nextSortMethods = [...allSortMethods];
      
      // If we have already fetched using some methods, prioritize the ones we haven't tried yet
      if (tokenData.fetchedMethods.length > 0) {
        nextSortMethods = allSortMethods.filter(method => !tokenData.fetchedMethods.includes(method));
        // If we've exhausted all methods, start over with most_relevant
        if (nextSortMethods.length === 0) {
          nextSortMethods = ['most_relevant'];
        }
      }
      
      // Get the current sort method to use
      const currentSortMethod = nextSortMethods[0];
      console.log(`Using sort method: ${currentSortMethod} for next page of reviews`);
      
      // Fetch reviews for this sort method
      const reviewsResponse = await this.fetchReviewsWithSort(placeId, language, currentSortMethod);
      
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
      
      // Update the token data
      tokenData.sortMethod = currentSortMethod;
      if (!tokenData.fetchedMethods.includes(currentSortMethod)) {
        tokenData.fetchedMethods.push(currentSortMethod);
      }
      
      // Determine if there are more results
      const hasMoreReviews = 
        // We have more sort methods to try
        nextSortMethods.length > 1 ||
        // Or we didn't get a full page of results from this sort method
        reviewsResponse.results.length > uniqueReviews.length;
      
      // Create a new page token
      const nextPageToken = hasMoreReviews ? 
        Buffer.from(JSON.stringify({
          sortMethod: currentSortMethod,
          fetchedMethods: tokenData.fetchedMethods,
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
          // Can't provide these accurately with chunked loading
          pageSize: pageSize,
          // We can estimate based on summary
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