import { z } from 'zod';

export const geocodeRequestSchema = z.object({
  address: z.string().min(1, 'Address is required'),
  provider: z.string().optional(),
  options: z.object({
    country: z.string().optional(),
    language: z.string().optional(),
    bounds: z.object({
      northeast: z.object({
        lat: z.number(),
        lng: z.number(),
      }),
      southwest: z.object({
        lat: z.number(),
        lng: z.number(),
      }),
    }).optional(),
  }).optional(),
});

export const reviewRequestSchema = z.object({
  placeId: z.string().min(1, 'Place ID is required'),
  maxResults: z.number().positive().max(100).optional(),
  language: z.string().optional(),
  minimumRating: z.number().min(1).max(5).optional(),
  pageToken: z.string().optional(),
  chunked: z.boolean().optional(),
}); 