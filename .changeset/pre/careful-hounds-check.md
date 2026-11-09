---
"desktop": patch
---

Email backgrounds and styles are cleaned more strictly: image addresses with unsafe schemes, and ones pointing at the app's own link handler, are now removed. None of them could load before either, so nothing looks different.
