import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdentity, signLease, sha256 } from '../server/crypto.mjs';
import { KeydockClient, verifyLease } from '../sdk/javascript/index.mjs';

const identity = createIdentity(), origin = 'https://licenses.example.com', fingerprint = 'persistent-installation-id';
const productId = '11111111-1111-4111-8111-111111111111';
function lease(overrides = {}) {
  const now = Math.floor(Date.now()/1000);
  return signLease({v:1,iss:origin,aud:productId,sub:'license-id',jti:'lease-id',iat:now,nbf:now,exp:now+3600,device:sha256(fingerprint),activationId:'activation-id',entitlements:['export'],...overrides},identity);
}

test('SDK derives privileges only from verified signed claims', async () => {
  const client = new KeydockClient({baseUrl:origin,productId,publicKey:identity.signing.publicKey,fetchImpl:async () => new Response(JSON.stringify({lease:lease(),entitlements:['admin'],licenseId:'attacker'}))});
  const result = await client.activate({key:'example-license-key',fingerprint});
  assert.deepEqual(result.entitlements,['export']); assert.equal(result.licenseId,'license-id');
});
test('SDK rejects unsigned online responses and does not fall back on denial', async () => {
  const options = {baseUrl:origin,productId,publicKey:identity.signing.publicKey};
  const broken = new KeydockClient({...options,fetchImpl:async () => new Response(JSON.stringify({valid:true,entitlements:['export']}))});
  await assert.rejects(broken.activate({key:'example-license-key',fingerprint}),{code:'INVALID_LEASE'});
  const denied = new KeydockClient({...options,fetchImpl:async () => new Response(JSON.stringify({error:{code:'LICENSE_REVOKED',message:'Revoked'}}),{status:403})});
  await assert.rejects(denied.validate({key:'example-license-key',fingerprint}),{code:'LICENSE_REVOKED',status:403});
});
test('SDK enforces trusted transport, time and canonical PEM handling', () => {
  assert.throws(() => new KeydockClient({baseUrl:'http://public.example.com',productId,publicKey:identity.signing.publicKey}));
  assert.throws(() => new KeydockClient({baseUrl:'https://example.com/path',productId,publicKey:identity.signing.publicKey}));
  const opts = {productId,fingerprint,issuer:origin};
  assert.equal(verifyLease(lease(),identity.signing.publicKey.replaceAll('\n','\r\n'),opts).sub,'license-id');
  assert.throws(() => verifyLease(lease(),identity.signing.publicKey,{...opts,now:NaN}));
  assert.throws(() => verifyLease(lease({exp:1}),identity.signing.publicKey,opts));
});
test('SDK bounds responses and rejects redirection or network failure', async () => {
  const options = {baseUrl:origin,productId,publicKey:identity.signing.publicKey};
  let requestOptions;
  const client = new KeydockClient({...options,fetchImpl:async (_url,opts) => {requestOptions=opts;return new Response('x'.repeat(70000));}});
  await assert.rejects(client.activate({key:'example-license-key',fingerprint}),{code:'CONNECTION_FAILED'});
  assert.equal(requestOptions.redirect,'error'); assert.ok(requestOptions.signal);
});
