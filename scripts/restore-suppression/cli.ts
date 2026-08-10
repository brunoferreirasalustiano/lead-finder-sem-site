import { exportManifest } from './export.js';
import { exportPrecontactHmacKey, recoverPrecontactHmacKey } from './key-recovery.js';
import { loadManifest } from './validate.js';
import { reconcile } from './apply.js';
import { verifyReconciliation } from './verify.js';

const option=(name:string)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:undefined};
const command=process.argv[2];
try {
  if(command==='export'){
    const output=option('--output');
    if(!output)throw new Error('MANIFEST_OUTPUT_REQUIRED');
    const m=await exportManifest(output);
    process.stdout.write(JSON.stringify({version:m.schemaVersion,totalEntries:m.entries.length,result:'SAFE'})+'\n');
  }
  else if(command==='export-key'){
    const output=option('--output');
    const manifestPath=option('--manifest');
    if(!output)throw new Error('PRECONTACT_HMAC_KEY_OUTPUT_REQUIRED');
    if(!manifestPath)throw new Error('MANIFEST_REQUIRED');
    const m=await loadManifest(manifestPath);
    const result=await exportPrecontactHmacKey(output);
    if(result.keyDigest!==m.precontactPermanent.keyDigest)throw new Error('PRECONTACT_HMAC_KEY_CAPSULE_DIGEST_MISMATCH');
    process.stdout.write(JSON.stringify({version:m.schemaVersion,result:'SAFE',keyDigest:result.keyDigest})+'\n');
  }
  else {
    const path=option('--manifest');
    if(!path)throw new Error('MANIFEST_REQUIRED');
    const m=await loadManifest(path);
    if(command==='validate')process.stdout.write(JSON.stringify({version:m.schemaVersion,totalEntries:m.entries.length,validEntries:m.entries.length,result:'SAFE'})+'\n');
    else if(command==='recover-key'){
      const keyFile=option('--key-file');
      if(!keyFile)throw new Error('PRECONTACT_HMAC_KEY_FILE_REQUIRED');
      const r=await recoverPrecontactHmacKey(keyFile,m);
      process.stdout.write(JSON.stringify({version:m.schemaVersion,result:'SAFE',...r})+'\n');
    }
    else if(command==='apply'){
      const r=await reconcile(m,process.argv.includes('--apply'),option('--actor')??'restore-operator');
      process.stdout.write(JSON.stringify(r)+'\n');
      if(r.result==='BLOCKED')process.exitCode=2;
    }
    else if(command==='verify')process.stdout.write(JSON.stringify({version:m.schemaVersion,totalEntries:m.entries.length,result:await verifyReconciliation(m)})+'\n');
    else throw new Error('UNKNOWN_COMMAND');
  }
} catch(error){
  process.stdout.write(JSON.stringify({version:'1.0',result:'BLOCKED',reason:error instanceof Error?error.message:'UNKNOWN_ERROR'})+'\n');
  process.exitCode=2;
}
