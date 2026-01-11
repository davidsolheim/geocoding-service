import crypto from 'crypto';

// Generate a secure random API key
function generateApiKey() {
  // Generate 32 random bytes and convert to hex
  return `geo_${crypto.randomBytes(32).toString('hex')}`;
}

// Generate an API key
const apiKey = generateApiKey();
console.log('\nGenerated API Key:');
console.log('------------------');
console.log(apiKey);
console.log('\nAdd this key to your ALLOWED_API_KEYS in .env:');
console.log('------------------');
console.log(`ALLOWED_API_KEYS=${apiKey}`);
console.log('\nOr append it to existing keys with a comma:');
console.log('------------------');
console.log(`ALLOWED_API_KEYS=existing_key_1,existing_key_2,${apiKey}`); 