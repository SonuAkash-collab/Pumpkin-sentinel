const puppeteer = require('puppeteer');

(async() => {
  try{
    const url = 'http://127.0.0.1:5174/';
    console.log('Opening', url);
    const browser = await puppeteer.launch({args:['--no-sandbox','--disable-setuid-sandbox']});
    const page = await browser.newPage();
    page.on('console', msg => console.log('BROWSER:', msg.text()));
    page.on('pageerror', err => console.error('BROWSER PAGE ERROR:', err));
    await page.goto(url, {waitUntil: 'networkidle2', timeout: 60000});

    // Wait for diagnostic button
    await page.waitForSelector('#diagBtn', {timeout: 20000});
    console.log('Found #diagBtn — clicking');
    await page.click('#diagBtn');

  // Wait briefly for the page to settle
  await new Promise((r) => setTimeout(r, 1000));

    // Try to call an in-page diagnostics function if it exists, and also
    // attempt to load the TF.js models directly in the page context.
    const pageCheck = await page.evaluate(async () => {
      const result = {};
      // call runDiagnostics() or runDiagnosticsMinimal if exposed
      if (typeof window.runDiagnostics === 'function') {
        try {
          const r = await window.runDiagnostics();
          result.runDiagnostics = typeof r === 'undefined' ? 'ok' : r;
        } catch (e) {
          result.runDiagnosticsError = (e && e.message) ? e.message : String(e);
        }
      } else if (typeof window.runDiagnosticsMinimal === 'function') {
        try {
          const r = await window.runDiagnosticsMinimal();
          result.runDiagnosticsMinimal = typeof r === 'undefined' ? 'ok' : r;
        } catch (e) {
          result.runDiagnosticsMinimalError = (e && e.message) ? e.message : String(e);
        }
      } else {
        result.runDiagnostics = 'not_found';
      }

      // Try loading TF.js models directly (use absolute path relative to server)
      try {
        if (window.tf && typeof window.tf.loadLayersModel === 'function') {
          try {
            const m = await window.tf.loadLayersModel('/model/eye_state_model/model.json');
            result.eyeModel = 'loaded';
            try{
              // build a dummy input matching the model's first input shape (batch=1)
              const inShape = (m.inputs && m.inputs[0] && m.inputs[0].shape) || null;
              if(Array.isArray(inShape)){
                const shape = inShape.map(s => (s === null ? 1 : s));
                const t = window.tf.randomNormal(shape);
                const pred = m.predict(t);
                const data = await (pred.data ? pred.data() : pred.array());
                result.eyeModelPredict = Array.from(data).slice(0,5);
                if(t.dispose) t.dispose();
                if(pred.dispose) pred.dispose();
              } else {
                result.eyeModelPredict = 'no_input_shape';
              }
            }catch(e){
              result.eyeModelPredictError = (e && e.message) ? e.message : String(e);
            }
          } catch (e) {
            result.eyeModelError = (e && e.message) ? e.message : String(e);
          }
          try {
            const m2 = await window.tf.loadLayersModel('/model/mouth_classifier_model/model.json');
            result.mouthModel = 'loaded';
            try{
              const inShape = (m2.inputs && m2.inputs[0] && m2.inputs[0].shape) || null;
              if(Array.isArray(inShape)){
                const shape = inShape.map(s => (s === null ? 1 : s));
                const t2 = window.tf.randomNormal(shape);
                const pred2 = m2.predict(t2);
                const data2 = await (pred2.data ? pred2.data() : pred2.array());
                // for classifier, report top-1 index
                const arr = Array.from(data2);
                let topIndex = -1;
                if(arr.length>1){
                  let max=-Infinity; for(let i=0;i<arr.length;i++){ if(arr[i]>max){max=arr[i];topIndex=i;} }
                  result.mouthModelPredict = {topIndex, topValue: arr[topIndex], sample: arr.slice(0,8)};
                } else {
                  result.mouthModelPredict = arr.slice(0,5);
                }
                if(t2.dispose) t2.dispose();
                if(pred2.dispose) pred2.dispose();
              } else {
                result.mouthModelPredict = 'no_input_shape';
              }
            }catch(e){
              result.mouthModelPredictError = (e && e.message) ? e.message : String(e);
            }
          } catch (e) {
            result.mouthModelError = (e && e.message) ? e.message : String(e);
          }
        } else {
          result.tf = typeof window.tf === 'undefined' ? 'tf_not_found' : 'loadLayersModel_not_fn';
        }
      } catch (e) {
        result.modelLoadProbeError = (e && e.message) ? e.message : String(e);
      }

      // Read diagOutput if present
      const outEl = document.querySelector('#diagOutput');
      result.diagOutput = outEl ? (outEl.innerText || outEl.textContent || '') : null;
      return result;
    });

    console.log('\n===== PAGE CHECK OUTPUT START =====');
    console.log(JSON.stringify(pageCheck, null, 2));
    console.log('===== PAGE CHECK OUTPUT END =====\n');

    // Save a screenshot for inspection
    const screenshotPath = 'diag_result.png';
    await page.screenshot({path: screenshotPath, fullPage: true});
    console.log('Saved screenshot to', screenshotPath);

    await browser.close();
    process.exit(0);
  }catch(e){
    console.error('Diagnostic script failed:', e && e.stack ? e.stack : e);
    process.exit(2);
  }
})();
