#!/usr/bin/env bun

/**
 * API Endpoint Test Script
 * 
 * This script tests the actual /api/v1/geocode endpoint to ensure
 * the provider fallback logic works correctly in the real API.
 */

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3003';
const API_KEY = process.env.TEST_API_KEY || 'geo_b8eb90b9ed7a06726b6cb2f4f4f5b67722d6b18f22729a99b4419e990e98e4d8';

interface ApiTestCase {
  name: string;
  address: string;
  provider?: string;
  expectedProvider?: string;
  shouldSucceed: boolean;
}

const TEST_CASES: ApiTestCase[] = [
  {
    name: 'US Address - Auto Provider Selection',
    address: '1600 Amphitheatre Parkway, Mountain View, CA 94043',
    expectedProvider: 'census',
    shouldSucceed: true
  },
  {
    name: 'US Address - Explicit Census Provider',
    address: '1600 Pennsylvania Avenue NW, Washington, DC 20500',
    provider: 'census',
    expectedProvider: 'census',
    shouldSucceed: true
  },
  {
    name: 'International Address - Auto Provider Selection (should fallback to Google)',
    address: '10 Downing Street, London, UK',
    expectedProvider: 'google',
    shouldSucceed: true
  },
  {
    name: 'International Address - Explicit Google Provider',
    address: '1 Rue de Rivoli, Paris, France',
    provider: 'google',
    expectedProvider: 'google',
    shouldSucceed: true
  },
  {
    name: 'International Address - Census Provider (should fail)',
    address: '10 Downing Street, London, UK',
    provider: 'census',
    expectedProvider: 'census',
    shouldSucceed: false
  },
  {
    name: 'Invalid Address - Auto Provider Selection',
    address: 'This is not a real address at all',
    shouldSucceed: false
  }
];

class ApiEndpointTester {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  async runAllTests(): Promise<void> {
    console.log('🌐 Starting API Endpoint Tests...\n');
    console.log(`Testing API at: ${this.baseUrl}`);
    console.log(`Using API Key: ${this.apiKey.substring(0, 8)}...`);
    console.log(`\nRunning ${TEST_CASES.length} test cases\n`);

    let passed = 0;
    let failed = 0;

    for (let i = 0; i < TEST_CASES.length; i++) {
      const testCase = TEST_CASES[i];
      console.log(`Test ${i + 1}/${TEST_CASES.length}: ${testCase.name}`);
      
      try {
        const success = await this.runTestCase(testCase);
        if (success) {
          console.log('  ✅ PASSED\n');
          passed++;
        } else {
          console.log('  ❌ FAILED\n');
          failed++;
        }
      } catch (error) {
        console.log(`  ❌ FAILED (Error: ${error})\n`);
        failed++;
      }
      
      // Small delay between tests
      await this.delay(1000);
    }

    console.log('='.repeat(50));
    console.log('📊 TEST RESULTS');
    console.log('='.repeat(50));
    console.log(`Total tests: ${TEST_CASES.length}`);
    console.log(`Passed: ${passed} (${((passed / TEST_CASES.length) * 100).toFixed(1)}%)`);
    console.log(`Failed: ${failed} (${((failed / TEST_CASES.length) * 100).toFixed(1)}%)`);

    if (failed > 0) {
      console.log('\n❌ Some tests failed');
      process.exit(1);
    } else {
      console.log('\n✅ All tests passed!');
      process.exit(0);
    }
  }

  private async runTestCase(testCase: ApiTestCase): Promise<boolean> {
    try {
      const requestBody = {
        address: testCase.address,
        ...(testCase.provider && { provider: testCase.provider })
      };

      console.log(`  Request: ${JSON.stringify(requestBody)}`);

      const response = await fetch(`${this.baseUrl}/api/v1/geocode`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey
        },
        body: JSON.stringify(requestBody)
      });

      const data = await response.json();
      console.log(`  Response Status: ${response.status}`);
      console.log(`  Response Success: ${data.success}`);
      console.log(`  Provider Used: ${data.provider}`);
      console.log(`  Results Count: ${data.results?.length || 0}`);

      // Check if the test should succeed or fail
      if (testCase.shouldSucceed) {
        if (!response.ok || !data.success) {
          console.log(`  Expected success but got failure`);
          return false;
        }

        // Check expected provider if specified
        if (testCase.expectedProvider && data.provider !== testCase.expectedProvider) {
          console.log(`  Expected provider '${testCase.expectedProvider}' but got '${data.provider}'`);
          return false;
        }

        // Check response structure
        if (!this.validateResponseStructure(data)) {
          console.log(`  Response structure validation failed`);
          return false;
        }

        // For successful geocoding, should have at least one result
        if (data.results.length === 0) {
          console.log(`  Expected results but got none`);
          return false;
        }

      } else {
        // Test should fail
        if (response.ok && data.success && data.results.length > 0) {
          console.log(`  Expected failure but got success`);
          return false;
        }
      }

      return true;

    } catch (error) {
      console.log(`  Request failed: ${error}`);
      return false;
    }
  }

  private validateResponseStructure(data: unknown): boolean {
    // Check if data is an object
    if (typeof data !== 'object' || data === null) return false;
    
    const response = data as Record<string, unknown>;
    
    // Check required fields
    if (typeof response.success !== 'boolean') return false;
    if (typeof response.provider !== 'string') return false;
    if (!Array.isArray(response.results)) return false;

    // If there are results, validate the first one
    if (response.results.length > 0) {
      const result = response.results[0] as Record<string, unknown>;
      if (typeof result.latitude !== 'number') return false;
      if (typeof result.longitude !== 'number') return false;
      if (typeof result.formattedAddress !== 'string') return false;
      if (typeof result.confidence !== 'number') return false;
      if (typeof result.components !== 'object') return false;
    }

    return true;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run the tests
async function main() {
  if (!process.env.TEST_API_KEY) {
    console.error('❌ TEST_API_KEY environment variable is required');
    console.log('Set it to one of the keys from your ALLOWED_API_KEYS');
    process.exit(1);
  }

  const tester = new ApiEndpointTester(API_BASE_URL, API_KEY);
  await tester.runAllTests();
}

main().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
}); 