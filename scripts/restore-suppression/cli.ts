import { exportManifest } from './export.js';
import { exportPrecontactHmacKey, recoverPrecontactHmacKey } from './key-recovery.js';
import { loadManifest } from './validate.js';
import { reconcile } from './apply.js';
import { verifyReconciliation } from './verify.js';

const option=(name:string)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:undefined};
const command=process.argv[2];

const readRecoveryKeyFromStdin = async (): Promise<string> => {
  process.stdin.setEncoding('utf8');
  let value='';
  for await (const chunk of process.stdin) {
    value+=String(chunk);
    if(value.length>128)throw new Error('PRECONTACT_HMAC_KEY_INPUT_INVALID');
  }
  return value;
};

try {
  if(command==='export'){
    const output=option('--output');
    if(!output)throw new Error('MANIFEST_OUTPUT_REQUIRED');
    const m=await exportManifest(output);
    process.stdout.write(JSON.stringify({version:m.schemaVersion,totalEntries:m.entries.length,result:'SAFE'})+'\n');
  }
  else if(command==='export-key'){
    const manifestPath=option('--manifest');
    if(!manifestPath)throw new Error('MANIFEST_REQUIRED');
    const m=await loadManifest(manifestPath);
    const result=await exportPrecontactHmacKey();
    if(result.keyDigest!==m.precontactPermanent.keyDigest)throw new Error('PRECONTACT_HMAC_KEY_RECOVERY_DIGEST_MISMATCH');
    // The official restore flow captures this stdout directly into shell memory.
    // Never wrap this value in JSON, log it, persist it, or pass it in argv/env.
    process.stdout.write(result.keyHex+'\n');
  }
  else {
    const path=option('--manifest');
    if(!path)throw new Error('MANIFEST_REQUIRED');
    const m=await loadManifest(path);
    if(command==='validate')process.stdout.write(JSON.stringify({version:m.schemaVersion,totalEntries:m.entries.length,validEntries:m.entries.length,result:'SAFE'})+'\n');
    else if(command==='recover-key'){
      const recoveryKey=await readRecoveryKeyFromStdin();
      const r=await recoverPrecontactHmacKey(recoveryKey,m);
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
  const payload=JSON.stringify({version:'1.0',result:'BLOCKED',reason:error instanceof Error?error.message:'UNKNOWN_ERROR'})+'\n';
  if(command==='export-key')process.stderr.write(payload);
  else process.stdout.write(payload);
  process.exitCode=2;
}
