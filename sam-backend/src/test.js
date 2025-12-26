/**
 * Simple test for the MTG Card Lookup Lambda
 * Requires GEMINI_API_KEY environment variable or ~/.env file
 */

import { handler } from './index.js';
import { readFileSync } from 'fs';
import { homedir } from 'os';

// Load API key from ~/.env if not set
if (!process.env.GEMINI_API_KEY) {
  try {
    const envContent = readFileSync(`${homedir()}/.env`, 'utf8');
    const match = envContent.match(/GEMINI_API_KEY=(.+)/);
    if (match) {
      process.env.GEMINI_API_KEY = match[1].trim();
    }
  } catch {
    console.error('No GEMINI_API_KEY found. Set it in environment or ~/.env');
    process.exit(1);
  }
}

async function runTests() {
  let passed = 0;
  let failed = 0;

  // Test 1: OCR lookup with test image
  console.log('Test 1: OCR lookup with test.png...');
  try {
    const base64 = readFileSync('../test.png').toString('base64');
    const event = {
      path: '/lookup',
      body: JSON.stringify({ image: base64 })
    };
    const result = await handler(event);
    const body = JSON.parse(result.body);
    
    if (result.statusCode === 200 && body.found && body.card && body.card.name) {
      console.log(`  ✓ Found card: ${body.card.name}`);
      passed++;
    } else {
      console.log(`  ✗ Failed: ${JSON.stringify(body)}`);
      failed++;
    }
  } catch (e) {
    console.log(`  ✗ Error: ${e.message}`);
    failed++;
  }

  // Test 2: Lookup by name
  console.log('Test 2: Lookup by name "Lightning Bolt"...');
  try {
    const event = {
      path: '/lookup-by-name',
      body: JSON.stringify({ name: 'Lightning Bolt' })
    };
    const result = await handler(event);
    const body = JSON.parse(result.body);
    
    if (result.statusCode === 200 && body.found && body.card?.name === 'Lightning Bolt') {
      console.log(`  ✓ Found card: ${body.card.name}`);
      passed++;
    } else {
      console.log(`  ✗ Failed: ${JSON.stringify(body)}`);
      failed++;
    }
  } catch (e) {
    console.log(`  ✗ Error: ${e.message}`);
    failed++;
  }

  // Test 3: Invalid image should fail
  console.log('Test 3: Invalid image should return error...');
  try {
    const event = {
      path: '/lookup',
      body: JSON.stringify({ image: 'notvalidbase64' })
    };
    const result = await handler(event);
    const body = JSON.parse(result.body);
    
    if (result.statusCode === 400 && body.error) {
      console.log(`  ✓ Correctly rejected invalid image`);
      passed++;
    } else {
      console.log(`  ✗ Should have rejected: ${JSON.stringify(body)}`);
      failed++;
    }
  } catch (e) {
    console.log(`  ✗ Error: ${e.message}`);
    failed++;
  }

  // Summary
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();

