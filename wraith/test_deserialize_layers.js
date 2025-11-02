const tf = require('@tensorflow/tfjs');

async function main(){
  try{
    const url = 'http://127.0.0.1:5174/model/eye_state_model/model.json';
    console.log('Fetching model.json from', url);
    const res = await fetch(url);
    const doc = await res.json();
    const layers = doc.modelTopology.model_config.config.layers;
    console.log('Found', layers.length, 'layers. Attempting to deserialize each layer...');
    for(let i=0;i<layers.length;i++){
      const layer = layers[i];
      try{
        // attempt to deserialize layer config
        tf.layers.deserialize({class_name: layer.class_name, config: layer.config});
        console.log('[OK ]', i, layer.name || layer.class_name);
      }catch(e){
        console.error('[ERR]', i, layer.name || layer.class_name, e && e.message ? e.message : e);
        console.error(e.stack);
        break;
      }
    }
  }catch(e){
    console.error('Failed', e && e.stack ? e.stack : e);
    process.exitCode = 2;
  }
}

main();
