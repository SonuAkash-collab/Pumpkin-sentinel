const tf = require('@tensorflow/tfjs');

async function main(){
  try{
    console.log('Node TF.js version:', tf.version.tfjs);
    const url = 'http://127.0.0.1:5174/model/eye_state_model/model.json';
    console.log('Loading model from', url);
    const m = await tf.loadLayersModel(url);
    console.log('Loaded model:', m?.modelTopology?.model_config?.config?.name || m?.name || 'ok');
  }catch(e){
    console.error('Load failed:', e && e.stack ? e.stack : e);
    if(e && e.message) console.error('Message:', e.message);
    if(e && e.errors) console.error('Errors:', e.errors);
    process.exitCode = 2;
  }
}

main();
