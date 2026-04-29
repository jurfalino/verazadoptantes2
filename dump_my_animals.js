const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:3000/my-animals');
  
  // Wait a bit for React to hydrate and fetch
  await page.waitForTimeout(2000);
  
  const content = await page.content();
  console.log('CONTENT LENGTH:', content.length);
  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('--- BODY TEXT ---');
  console.log(bodyText);
  await browser.close();
})();
