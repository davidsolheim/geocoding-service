export interface ReviewRequest {
  placeId: string;
  maxResults?: number;
  language?: string;
  minimumRating?: number;
  pageToken?: string;
  chunked?: boolean;
}

export interface ReviewResponse {
  success: boolean;
  provider: string;
  results: Review[];
  summary?: PlaceSummary;
  pagination?: {
    nextPageToken?: string;
    hasMoreReviews: boolean;
    currentPage?: number;
    totalPages?: number;
    pageSize?: number;
    totalReviews?: number;
  };
  error?: {
    code: string;
    message: string;
  };
}

export interface PlaceSummary {
  name: string;
  rating: number;
  totalReviews: number;
  url?: string;
}

export interface Review {
  author: string;
  authorProfilePhoto?: string;
  rating: number;
  text: string;
  time: string;
  relativeTime?: string;
  language?: string;
  raw?: unknown;
}

export interface ReviewsProvider {
  name: string;
  getReviews(placeId: string, options?: {
    maxResults?: number;
    language?: string;
    minimumRating?: number;
    pageToken?: string;
  }): Promise<ReviewResponse>;
  isAvailable(): Promise<boolean>;
  getRateLimit(): {
    requests: number;
    period: number;
  };
} 