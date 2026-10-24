"""Keydock client. Never embeds management secrets or silently grants offline access."""
import base64
import hashlib
import json
import math
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey


class KeydockError(Exception):
    def __init__(self, code, message, status=0):
        super().__init__(message)
        self.code, self.status = code, status


def _decode(value):
    if not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise ValueError("Invalid lease encoding")
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def verify_lease(token, public_key, *, product_id, fingerprint, issuer, now=None):
    if not isinstance(token, str) or len(token) > 32768:
        raise ValueError("Invalid lease")
    header, payload, signature = token.split(".")
    key = serialization.load_pem_public_key(public_key.encode())
    if not isinstance(key, Ed25519PublicKey):
        raise ValueError("An Ed25519 public key is required")
    pem = key.public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    h = json.loads(_decode(header))
    if not isinstance(h, dict) or h.get("alg") != "EdDSA" or h.get("typ") != "JWT" or "crit" in h or h.get("kid") != hashlib.sha256(pem).hexdigest()[:16]:
        raise ValueError("Untrusted signing key")
    key.verify(_decode(signature), (header + "." + payload).encode())
    claims = json.loads(_decode(payload))
    timestamp = time.time() if now is None else now
    if not isinstance(timestamp, (int, float)) or not math.isfinite(timestamp):
        raise ValueError("Invalid verification time")
    if not isinstance(claims, dict) or not product_id or not fingerprint or not issuer or claims.get("aud") != product_id or claims.get("iss") != issuer or claims.get("device") != hashlib.sha256(fingerprint.encode()).hexdigest():
        raise ValueError("Lease does not match this application or device")
    if any(type(claims.get(field)) is not int for field in ("iat", "nbf", "exp")):
        raise ValueError("Invalid lease timestamps")
    if claims.get("v") != 1 or claims["exp"] <= math.floor(timestamp) or claims["nbf"] > timestamp + 30 or claims["iat"] > timestamp + 30 or claims["exp"] <= claims["iat"] or not isinstance(claims.get("sub"), str) or not isinstance(claims.get("activationId"), str) or not isinstance(claims.get("entitlements"), list) or any(not isinstance(x, str) for x in claims["entitlements"]):
        raise ValueError("Expired or malformed lease")
    return claims


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class KeydockClient:
    def __init__(self, base_url, product_id, public_key, timeout=10):
        url = urllib.parse.urlsplit(base_url)
        if url.username or url.password or url.path or url.query or url.fragment or not url.hostname or (url.scheme != "https" and not (url.scheme == "http" and url.hostname in ("127.0.0.1", "localhost", "::1"))):
            raise ValueError("Use an HTTPS origin, or HTTP loopback for development")
        if not product_id or not public_key or not 0.5 <= timeout <= 60:
            raise ValueError("A product ID, pinned public key and 0.5–60 second timeout are required")
        self.base_url, self.product_id, self.public_key, self.timeout = base_url, product_id, public_key, timeout
        self._opener = urllib.request.build_opener(_NoRedirect())

    def _request(self, operation, key, fingerprint, name="Unnamed device"):
        body = json.dumps({"productId": self.product_id, "key": key, "fingerprint": fingerprint, "name": name}).encode()
        request = urllib.request.Request(self.base_url + "/api/v1/client/" + operation, data=body, headers={"Content-Type": "application/json", "Accept": "application/json"}, method="POST")
        try:
            with self._opener.open(request, timeout=self.timeout) as response:
                raw = response.read(65537)
                if len(raw) > 65536:
                    raise ValueError("Response too large")
                data = json.loads(raw)
        except urllib.error.HTTPError as error:
            try:
                data = json.loads(error.read(65536)).get("error", {})
            except (ValueError, AttributeError):
                data = {}
            finally:
                error.close()
            raise KeydockError(data.get("code", "REQUEST_FAILED"), data.get("message", "License request was denied"), error.code) from None
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            raise KeydockError("CONNECTION_FAILED", "Could not reach the licensing server securely") from None
        if operation == "deactivate":
            if not isinstance(data, dict) or data.get("released") is not True:
                raise KeydockError("INVALID_RESPONSE", "Invalid release response")
            return {"released": True}
        try:
            claims = self.verify(data["lease"], fingerprint)
        except Exception:
            raise KeydockError("INVALID_LEASE", "The licensing server returned an invalid or untrusted lease") from None
        return {"lease": data["lease"], "claims": claims, "entitlements": claims["entitlements"], "licenseId": claims["sub"], "activationId": claims["activationId"], "leaseExpiresAt": claims["exp"] * 1000}

    def activate(self, key, fingerprint, name="Unnamed device"):
        return self._request("activate", key, fingerprint, name)

    def validate(self, key, fingerprint, name="Unnamed device"):
        return self._request("validate", key, fingerprint, name)

    def deactivate(self, key, fingerprint, name="Unnamed device"):
        return self._request("deactivate", key, fingerprint, name)

    def verify(self, lease, fingerprint, *, now=None):
        return verify_lease(lease, self.public_key, product_id=self.product_id, fingerprint=fingerprint, issuer=self.base_url, now=now)
