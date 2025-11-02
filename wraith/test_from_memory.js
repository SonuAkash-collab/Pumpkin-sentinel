const tf = require('@tensorflow/tfjs');
const fetch = globalThis.fetch || require('node-fetch');

async function loadViaFromMemory(url){
  console.log('Fetching model.json', url);
  const res = await fetch(url);
  const j = await res.json();
  const manifests = j.weightsManifest || [];
  const parts = [];
  const weightSpecs = [];
  for(const group of manifests){
    for(const p of (group.paths||[])){
      const u = new URL(p, url).href;
      console.log('Fetching shard', u);
      const r = await fetch(u);
      const ab = await r.arrayBuffer();
      parts.push(ab);
    }
    if(Array.isArray(group.weights)) weightSpecs.push(...group.weights);
  }
  // concat
  let total = 0; for(const a of parts) total += a.byteLength;
  const weightData = new Uint8Array(total);
  let off = 0; for(const a of parts){ weightData.set(new Uint8Array(a), off); off += a.byteLength; }

  // Try with full modelTopology
  try{
    console.log('Trying fromMemory with modelTopology (full)');
    const ioHandler = tf.io.fromMemory({ modelTopology: j.modelTopology, weightSpecs, weightData: weightData.buffer });
    const m = await tf.loadLayersModel(ioHandler);
    console.log('Loaded with full modelTopology, model name:', m?.name || m?.modelTopology?.model_config?.config?.name);
    return;
  }catch(e){
    console.error('Full modelTopology failed:', e && e.message);
  }

  // Try with model_config
  try{
    console.log('Trying fromMemory with modelTopology=model_config');
    const ioHandler2 = tf.io.fromMemory({ modelTopology: j.modelTopology.model_config, weightSpecs, weightData: weightData.buffer });
    const m2 = await tf.loadLayersModel(ioHandler2);
    console.log('Loaded with model_config variant, name:', m2?.name || m2?.modelTopology?.model_config?.config?.name);
    return;
  }catch(e){
    console.error('model_config variant failed:', e && e.message);
  }
}

loadViaFromMemory('http://127.0.0.1:5174/model/eye_state_model/model.json').catch(e=>{console.error(e);process.exitCode=2});
