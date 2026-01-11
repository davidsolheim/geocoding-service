#!/usr/bin/env bun

/**
 * Provider Consistency Test Script
 * 
 * This script tests both Census and Google geocoding providers to ensure
 * they return data in exactly the same format. This is critical for
 * maintaining API consistency for downstream services.
 */

import { GoogleProvider } from '../app/providers/google';
import { CensusProvider } from '../app/providers/census';
import { GeocodeResponse } from '../app/types/geocoding';

// Test addresses covering various scenarios
const TEST_ADDRESSES = [
  // Standard US addresses
  '1600 Amphitheatre Parkway, Mountain View, CA 94043',
  '1 Apple Park Way, Cupertino, CA 95014',
  '350 5th Ave, New York, NY 10118', // Empire State Building
  '1600 Pennsylvania Avenue NW, Washington, DC 20500', // White House
  
  // Different formats
  '123 Main Street, Springfield, IL',
  '456 Oak Ave, Suite 100, Chicago, IL 60601',
  '789 Pine St, Los Angeles, CA',
  
  // Edge cases
  'Times Square, New York, NY',
  'Central Park, New York, NY',
  '90210', // Just ZIP code
  
  // International (should fail for Census)
  '10 Downing Street, London, UK',
  '1 Rue de Rivoli, Paris, France',
  
  // Invalid/problematic addresses
  'This is not a real address',
  '123 Fake Street, Nowhere, ZZ 99999',
];

interface TestResult {
  address: string;
  censusResponse: GeocodeResponse;
  googleResponse: GeocodeResponse;
  consistent: boolean;
  issues: string[];
}

class ProviderConsistencyTester {
  private censusProvider: CensusProvider;
  private googleProvider: GoogleProvider;
  private results: TestResult[] = [];

  constructor() {
    this.censusProvider = new CensusProvider();
    this.googleProvider = new GoogleProvider();
  }

  async runAllTests(): Promise<void> {
    console.log('🧪 Starting Provider Consistency Tests...\n');
    console.log(`Testing ${TEST_ADDRESSES.length} addresses with both providers\n`);

    // Check if providers are available
    const censusAvailable = await this.censusProvider.isAvailable();
    const googleAvailable = await this.googleProvider.isAvailable();

    console.log(`Census Provider Available: ${censusAvailable ? '✅' : '❌'}`);
    console.log(`Google Provider Available: ${googleAvailable ? '✅' : '❌'}\n`);

    if (!censusAvailable && !googleAvailable) {
      console.error('❌ Both providers are unavailable. Cannot run tests.');
      process.exit(1);
    }

    // Test each address
    for (let i = 0; i < TEST_ADDRESSES.length; i++) {
      const address = TEST_ADDRESSES[i];
      console.log(`Testing ${i + 1}/${TEST_ADDRESSES.length}: "${address}"`);
      
      try {
        await this.testAddress(address);
      } catch (error) {
        console.error(`Error testing address "${address}":`, error);
      }
      
      // Add small delay to be respectful to APIs
      await this.delay(500);
    }

    // Generate report
    this.generateReport();
  }

  private async testAddress(address: string): Promise<void> {
    const censusResponse = await this.censusProvider.geocode(address);
    const googleResponse = await this.googleProvider.geocode(address);

    const issues = this.compareResponses(censusResponse, googleResponse);
    const consistent = issues.length === 0;

    this.results.push({
      address,
      censusResponse,
      googleResponse,
      consistent,
      issues
    });

    console.log(`  ${consistent ? '✅' : '❌'} ${consistent ? 'Consistent' : `Issues: ${issues.length}`}`);
    if (!consistent) {
      issues.forEach(issue => console.log(`    - ${issue}`));
    }
  }

  private compareResponses(census: GeocodeResponse, google: GeocodeResponse): string[] {
    const issues: string[] = [];

    // Check response structure
    this.validateResponseStructure(census, 'Census', issues);
    this.validateResponseStructure(google, 'Google', issues);

    // Compare field types and presence
    if (typeof census.success !== typeof google.success) {
      issues.push(`success field type mismatch: Census(${typeof census.success}) vs Google(${typeof google.success})`);
    }

    if (typeof census.provider !== typeof google.provider) {
      issues.push(`provider field type mismatch: Census(${typeof census.provider}) vs Google(${typeof google.provider})`);
    }

    if (!Array.isArray(census.results) || !Array.isArray(google.results)) {
      issues.push('results field must be an array in both responses');
    }

    // If both have results, compare result structure
    if (census.results.length > 0 && google.results.length > 0) {
      const censusResult = census.results[0];
      const googleResult = google.results[0];

      this.validateResultStructure(censusResult, 'Census', issues);
      this.validateResultStructure(googleResult, 'Google', issues);

      // Compare coordinate types
      if (typeof censusResult.latitude !== typeof googleResult.latitude) {
        issues.push(`latitude type mismatch: Census(${typeof censusResult.latitude}) vs Google(${typeof googleResult.latitude})`);
      }

      if (typeof censusResult.longitude !== typeof googleResult.longitude) {
        issues.push(`longitude type mismatch: Census(${typeof censusResult.longitude}) vs Google(${typeof googleResult.longitude})`);
      }

      // Check components structure
      if (censusResult.components && googleResult.components) {
        this.validateComponentsStructure(censusResult.components, 'Census', issues);
        this.validateComponentsStructure(googleResult.components, 'Google', issues);
      }
    }

    // Check error structure if present
    if (census.error || google.error) {
      if (census.error && !this.isValidError(census.error)) {
        issues.push('Census error object structure is invalid');
      }
      if (google.error && !this.isValidError(google.error)) {
        issues.push('Google error object structure is invalid');
      }
    }

    return issues;
  }

  private validateResponseStructure(response: GeocodeResponse, provider: string, issues: string[]): void {
    const requiredFields = ['success', 'provider', 'results'];
    
    for (const field of requiredFields) {
      if (!(field in response)) {
        issues.push(`${provider}: Missing required field '${field}'`);
      }
    }

    if (typeof response.success !== 'boolean') {
      issues.push(`${provider}: 'success' must be boolean, got ${typeof response.success}`);
    }

    if (typeof response.provider !== 'string') {
      issues.push(`${provider}: 'provider' must be string, got ${typeof response.provider}`);
    }

    if (!Array.isArray(response.results)) {
      issues.push(`${provider}: 'results' must be array, got ${typeof response.results}`);
    }
  }

  private validateResultStructure(result: GeocodeResponse['results'][0], provider: string, issues: string[]): void {
    const requiredFields = ['latitude', 'longitude', 'formattedAddress', 'confidence', 'components'];
    
    for (const field of requiredFields) {
      if (!(field in result)) {
        issues.push(`${provider} result: Missing required field '${field}'`);
      }
    }

    if (typeof result.latitude !== 'number' || isNaN(result.latitude)) {
      issues.push(`${provider} result: 'latitude' must be a valid number`);
    }

    if (typeof result.longitude !== 'number' || isNaN(result.longitude)) {
      issues.push(`${provider} result: 'longitude' must be a valid number`);
    }

    if (typeof result.formattedAddress !== 'string') {
      issues.push(`${provider} result: 'formattedAddress' must be string`);
    }

    if (typeof result.confidence !== 'number' || result.confidence < 0 || result.confidence > 1) {
      issues.push(`${provider} result: 'confidence' must be number between 0 and 1`);
    }

    if (typeof result.components !== 'object' || result.components === null) {
      issues.push(`${provider} result: 'components' must be an object`);
    }
  }

  private validateComponentsStructure(components: GeocodeResponse['results'][0]['components'], provider: string, issues: string[]): void {
    // Validate each component field
    if (components?.street !== undefined && typeof components.street !== 'string') {
      issues.push(`${provider} components: 'street' must be string or undefined, got ${typeof components.street}`);
    }
    if (components?.city !== undefined && typeof components.city !== 'string') {
      issues.push(`${provider} components: 'city' must be string or undefined, got ${typeof components.city}`);
    }
    if (components?.state !== undefined && typeof components.state !== 'string') {
      issues.push(`${provider} components: 'state' must be string or undefined, got ${typeof components.state}`);
    }
    if (components?.country !== undefined && typeof components.country !== 'string') {
      issues.push(`${provider} components: 'country' must be string or undefined, got ${typeof components.country}`);
    }
    if (components?.postalCode !== undefined && typeof components.postalCode !== 'string') {
      issues.push(`${provider} components: 'postalCode' must be string or undefined, got ${typeof components.postalCode}`);
    }
  }

  private isValidError(error: { code: string; message: string }): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      typeof error.code === 'string' &&
      typeof error.message === 'string'
    );
  }

  private generateReport(): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 PROVIDER CONSISTENCY TEST REPORT');
    console.log('='.repeat(60));

    const totalTests = this.results.length;
    const consistentTests = this.results.filter(r => r.consistent).length;
    const inconsistentTests = totalTests - consistentTests;

    console.log(`\nSUMMARY:`);
    console.log(`Total addresses tested: ${totalTests}`);
    console.log(`Consistent responses: ${consistentTests} (${((consistentTests/totalTests)*100).toFixed(1)}%)`);
    console.log(`Inconsistent responses: ${inconsistentTests} (${((inconsistentTests/totalTests)*100).toFixed(1)}%)`);

    if (inconsistentTests > 0) {
      console.log(`\n❌ INCONSISTENCIES FOUND:`);
      
      const allIssues = this.results.flatMap(r => r.issues);
      const issueTypes = new Map<string, number>();
      
      allIssues.forEach(issue => {
        issueTypes.set(issue, (issueTypes.get(issue) || 0) + 1);
      });

      Array.from(issueTypes.entries())
        .sort((a, b) => b[1] - a[1])
        .forEach(([issue, count]) => {
          console.log(`  ${count}x: ${issue}`);
        });

      console.log(`\nDETAILED ISSUES BY ADDRESS:`);
      this.results
        .filter(r => !r.consistent)
        .forEach(result => {
          console.log(`\n"${result.address}":`);
          result.issues.forEach(issue => console.log(`  - ${issue}`));
        });
    } else {
      console.log(`\n✅ All responses are consistent!`);
    }

    // Sample response comparison
    console.log(`\nSAMPLE RESPONSE FORMATS:`);
    const successfulResult = this.results.find(r => 
      r.censusResponse.success && r.censusResponse.results.length > 0 &&
      r.googleResponse.success && r.googleResponse.results.length > 0
    );

    if (successfulResult) {
      console.log(`\nAddress: "${successfulResult.address}"`);
      console.log(`\nCensus Response Structure:`);
      console.log(JSON.stringify(this.sanitizeForDisplay(successfulResult.censusResponse), null, 2));
      console.log(`\nGoogle Response Structure:`);
      console.log(JSON.stringify(this.sanitizeForDisplay(successfulResult.googleResponse), null, 2));
    }

    console.log('\n' + '='.repeat(60));

    // Exit with error code if inconsistencies found
    if (inconsistentTests > 0) {
      console.log('❌ Test failed due to inconsistencies');
      process.exit(1);
    } else {
      console.log('✅ All tests passed!');
      process.exit(0);
    }
  }

  private sanitizeForDisplay(response: GeocodeResponse) {
    return {
      success: response.success,
      provider: response.provider,
      results: response.results.map(result => ({
        latitude: typeof result.latitude,
        longitude: typeof result.longitude,
        formattedAddress: typeof result.formattedAddress,
        confidence: typeof result.confidence,
        components: {
          street: typeof result.components?.street,
          city: typeof result.components?.city,
          state: typeof result.components?.state,
          country: typeof result.components?.country,
          postalCode: typeof result.components?.postalCode,
        },
        raw: typeof result.raw,
      })),
      error: response.error ? {
        code: typeof response.error.code,
        message: typeof response.error.message,
      } : undefined,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run the tests
async function main() {
  const tester = new ProviderConsistencyTester();
  await tester.runAllTests();
}

main().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
}); 