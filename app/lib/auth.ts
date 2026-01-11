const ALLOWED_API_KEYS = (process.env.ALLOWED_API_KEYS || '').split(',').filter(Boolean);

export function validateApiKey(apiKey?: string): boolean {
  if (!apiKey) return false;
  return ALLOWED_API_KEYS.includes(apiKey);
}

export function getApiKeyFromRequest(request: Request): string | undefined {
  return request.headers.get('x-api-key') || undefined;
} 