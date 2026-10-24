import base64
import hashlib
import json
import time
import unittest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization
from keydock import verify_lease, KeydockClient


class VerificationTests(unittest.TestCase):
    def setUp(self):
        self.key = Ed25519PrivateKey.generate()
        self.pem = self.key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()
        self.options = dict(product_id="test-product", fingerprint="installation-fingerprint", issuer="https://licenses.example.com")

    def token(self, **overrides):
        encode = lambda value: base64.urlsafe_b64encode(value).decode().rstrip("=")
        now = int(time.time())
        header = encode(json.dumps(dict(alg="EdDSA",typ="JWT",kid=hashlib.sha256(self.pem.encode()).hexdigest()[:16])).encode())
        claims = dict(v=1,iss=self.options["issuer"],aud=self.options["product_id"],sub="license",activationId="device",iat=now,nbf=now,exp=now+3600,device=hashlib.sha256(self.options["fingerprint"].encode()).hexdigest(),entitlements=["export"])
        claims.update(overrides)
        payload = encode(json.dumps(claims).encode())
        body = (header + "." + payload).encode()
        return body.decode() + "." + encode(self.key.sign(body))

    def test_valid_signature_and_claims(self):
        self.assertEqual(verify_lease(self.token(),self.pem,**self.options)["entitlements"],["export"])

    def test_expired_future_or_invalid_types(self):
        for changes in [dict(exp=1),dict(iat=int(time.time())+1000),dict(exp=True),dict(entitlements="admin"),dict(aud="another-product"),dict(iss="https://attacker.example"),dict(device="wrong")]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                verify_lease(self.token(**changes),self.pem,**self.options)

    def test_forgery_rejected(self):
        token = self.token()
        parts = token.split(".")
        parts[1] = base64.urlsafe_b64encode(b'{"exp":9999999999}').decode().rstrip("=")
        with self.assertRaises(Exception):
            verify_lease(".".join(parts),self.pem,**self.options)

    def test_insecure_origin_rejected(self):
        for origin in ["http://example.com","https://example.com/path","https://user:secret@example.com"]:
            with self.assertRaises(ValueError):
                KeydockClient(origin,"product",self.pem)


if __name__ == "__main__":
    unittest.main()
