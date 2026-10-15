# Douyin study source regression

- Reported source: `https://www.douyin.com/jingxuan?modal_id=7692681703709863077`.
- Symptom: the study page opens but says it has not read this video.
- Confirmed defect: commit `0403e40` added `t()` to the function serialized by `scripting.executeScript`. The page does not receive the imported translation module. This affects all three successful snapshot branches. Earlier direct-call unit tests kept the module closure and missed the failure.
- Fix: keep page collection independent; apply the translated site name after returning to the extension. The existing URL/source checks are retained.
- Prevention: `check:injections` resolves current function injections and rejects module captures and async syntax requiring ES2015 helpers. It checks 15 distinct injected functions. Both `npm test` (CI) and fixed test delivery run this check. Tests include known bad imports/closures and known good DOM/argument/local-helper cases.
- The check also found an existing Bilibili page-fetch async helper dependency. Its Promise implementation preserves request credentials and response shape; a test compiles and serializes the actual function before executing it.
- Before fix: three added serialized Douyin cases failed with a missing module reference. After fix: all three pass; full suite 1,123 passed / 6 edition-specific skips; 14 workflow/checker tests passed; TypeScript passed.
- Live verification limitation: browser automation did not return a TaskSpace or page state for this source, and the web fetch tool could not access the page. Actual source acquisition, playback and caption generation in the installed extension are not verified by these tests.
- This patch is separate from the already-submitted 1.18.0 store package; updating the local testing folder does not update the pending store submission.
