const fetch = globalThis.fetch || require('node-fetch');

async function main(){
  const url = 'http://127.0.0.1:5174/model/eye_state_model/model.json';
  console.log('Fetching', url);
  const res = await fetch(url);
  const j = await res.json();
  console.log('Top-level keys:', Object.keys(j));
  const mt = j.modelTopology;
  console.log('modelTopology keys:', Object.keys(mt));
  console.log('model_config keys:', Object.keys(mt.model_config || {}));
  const cfg = mt.model_config?.config;
  console.log('model name:', cfg?.name);
  const layers = cfg?.layers || [];
  console.log('layers count:', layers.length);
  if(layers.length){
    console.log('first layer keys:', Object.keys(layers[0]));
    console.log('first layer class_name:', layers[0].class_name);
    console.log('first layer config keys sample:', Object.keys(layers[0].config || {}).slice(0,20));
  }
  // check for any dtype object
  const bad = [];
  for(const layer of layers){
    const d = layer.config?.dtype;
    if(d && typeof d === 'object') bad.push(layer.name || layer.class_name);
  }
  console.log('layers with object dtype:', bad);

  // print a sample inbound_nodes structure for a mid-layer
  for(const layer of layers){
    if(Array.isArray(layer.inbound_nodes) && layer.inbound_nodes.length){
      console.log('sample inbound_nodes for', layer.name || layer.class_name, ':', JSON.stringify(layer.inbound_nodes[0]));
      break;
    }
  }
}

main().catch(e=>{ console.error(e); process.exitCode=2; });
