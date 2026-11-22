---
"desktop": patch
---

The library that reads web addresses is updated with a security fix for a crash on deeply nested `blob:` addresses. It also writes a `^` in a link's path as `%5E`, as browsers do, so such a link shows and opens in that form.
