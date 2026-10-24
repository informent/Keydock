# Keydock Python client

Requires Python 3.11+ and `cryptography`. Install with `pip install ./sdk/python` from the repository. This package is not yet published to PyPI.

```python
from keydock import KeydockClient

client = KeydockClient("https://licenses.example.com", "YOUR-PRODUCT-UUID", PINNED_PUBLIC_KEY_PEM)
result = client.activate(user_entered_key, saved_installation_id, "My PC")
if "export" in result["entitlements"]:
    enable_export()

# Explicit offline verification of a saved, unexpired lease:
claims = client.verify(result["lease"], saved_installation_id)
```

Use a persistent random installation ID. Ship the public key with your application. Never fetch and trust a replacement public key alongside a lease. `KeydockError.code` distinguishes online denials and connection failures. Failed online requests do not fall back automatically. Offline verification raises an exception on any failure. Protect license keys and cached leases using OS protected storage.
