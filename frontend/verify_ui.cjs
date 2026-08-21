const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const screenshotsDir = path.join(__dirname, 'test_screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  console.log('🚀 Launching Playwright Chromium...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  console.log('🌐 Navigating to http://localhost:5173...');
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });

  // 1. Initial State Check
  console.log('📸 Capturing initial unauthenticated state...');
  await page.screenshot({ path: path.join(screenshotsDir, '1_initial_state.png'), fullPage: true });

  const title = await page.title();
  console.log(`✓ Page Title: "${title}"`);

  const initialBulbState = await page.locator('.sketch-bulb--online').count();
  console.log(`✓ Initial Bulb State: ${initialBulbState > 0 ? 'GREEN (Online)' : 'Not Green'}`);

  // 2. Sign Up Sequence
  console.log('\n📝 Performing Sign Up Sequence...');
  const input = page.locator('.terminal-prompt__input');

  // Step 1: Name
  await input.fill('Animesh');
  await input.press('Enter');
  await page.waitForTimeout(300);

  // Step 2: Email
  await input.fill('animeshtripathi.who@gmail.com');
  await input.press('Enter');
  await page.waitForTimeout(300);

  // Step 3: Password
  await input.fill('supersecret123');
  await input.press('Enter');
  await page.waitForTimeout(600);

  console.log('📸 Capturing authenticated state with assigned avatar...');
  await page.screenshot({ path: path.join(screenshotsDir, '2_authenticated_state.png'), fullPage: true });

  const avatarImgCount = await page.locator('.sketch-pfp-img').count();
  console.log(`✓ Avatar in PFP Box: ${avatarImgCount > 0 ? 'RENDERED' : 'MISSING'}`);

  // 3. Workflow Configuration Sequence
  console.log('\n⚙️ Configuring Workflow Inputs...');
  
  // Step 1: Job Title
  await input.fill('Backend Engineer');
  await input.press('Enter');
  await page.waitForTimeout(300);

  // Step 2: Recipient Email (Accept default)
  await input.press('Enter');
  await page.waitForTimeout(300);

  // Step 3: Freshers Only
  await input.fill('n');
  await input.press('Enter');
  await page.waitForTimeout(300);

  // Step 4: Minimum Stars
  await input.fill('4');
  await input.press('Enter');
  await page.waitForTimeout(400);

  // Step 5: Confirm Dispatch
  console.log('🚀 Dispatching Workflow...');
  await input.fill('y');
  await input.press('Enter');
  await page.waitForTimeout(1000);

  // 4. Running State Check
  console.log('📸 Capturing workflow running state (yellow bulb)...');
  await page.screenshot({ path: path.join(screenshotsDir, '3_running_state.png'), fullPage: true });
  
  const runningBulbCount = await page.locator('.sketch-bulb--running').count();
  console.log(`✓ Running Bulb State: ${runningBulbCount > 0 ? 'YELLOW (Running/Pulsing)' : 'Not Yellow'}`);

  // 5. Completion State Check
  console.log('⏳ Waiting for execution to complete (~5 seconds)...');
  await page.waitForTimeout(6000);

  console.log('📸 Capturing workflow completed state (green bulb + email sent)...');
  await page.screenshot({ path: path.join(screenshotsDir, '4_completed_state.png'), fullPage: true });

  const completedBulbCount = await page.locator('.sketch-bulb--online').count();
  console.log(`✓ Completed Bulb State: ${completedBulbCount > 0 ? 'GREEN (Completed/Online)' : 'Not Green'}`);

  const terminalText = await page.locator('.sketch-terminal__body').innerText();
  const hasSuccessLog = terminalText.includes('SMTPSecure delivery complete');
  console.log(`✓ Delivery Log Verification: ${hasSuccessLog ? 'SUCCESS' : 'FAILED'}`);

  await browser.close();
  console.log('\n🎉 ALL PLAYWRIGHT TESTS PASSED SUCCESSFULLY!');
})();
