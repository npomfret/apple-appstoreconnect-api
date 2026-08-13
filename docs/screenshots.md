# Adding a screenshot

```sh
node dist/cli.js screenshots                         # -> localizationIds, sets, display types
node dist/cli.js upload-screenshot <locId> APP_IPHONE_65 shot.png
node dist/cli.js delete-screenshot <screenshotId>
node dist/cli.js screenshot-set <locId> APP_IPHONE_65    # an empty set, if you want one
```

`upload-screenshot` does the whole dance, creating the set if that device size doesn't
have one yet: `POST appScreenshots` reserves a slot for a file of that name and size, the
response comes back with an `uploadOperations` array of presigned URLs, the bytes are PUT
to each in turn, and `PATCH appScreenshots/{id}` with `{"uploaded":true}` commits it. Skip
that last step and the screenshot stays an empty reservation that never appears on the
version page.

The upload legs go to `object-storage.apple.com`, not `appstoreconnect.apple.com`, and
carry **no cookie** — the presigned query string is the entire authentication. `uploadPart`
in `src/http.ts` bypasses the normal request path for exactly that reason, so the session
never follows the bytes to another host. Apple splits large files into several parts, so
the operations are replayed in order rather than assumed to be one PUT.

Verified end to end against a live app: create set, upload, `assetDeliveryState` goes to
`COMPLETE` with the dimensions Apple read back, then delete.

`assetDeliveryState` reads `UPLOAD_COMPLETE` the moment the commit lands and `COMPLETE`
once Apple has processed the file, at which point `sourceFileChecksum` (an MD5) and a
`downloadUrl` appear.

## Checks before uploading

Dimensions and the ten-per-set limit are checked before any bytes move, and a failure
stops the upload rather than warning past it — `--force` overrides. Failing early matters
because the alternative is a half-made asset on a live version.

```
$ node dist/cli.js upload-screenshot <locId> APP_IPHONE_65 wrong-size.png
Not uploading wrong-size.png: 800 × 600 is not a size APP_IPHONE_65 accepts — it takes
1242 × 2688, 2688 × 1242, 1284 × 2778, 2778 × 1284. Pass --force to upload anyway.
```

`SCREENSHOT_DISPLAY_TYPES` in `src/screenshots.ts` is complete and authoritative — iris
hands over the whole enum if you POST an invalid one, which is how it was obtained.

`SCREENSHOT_SIZES` is **not** complete, on purpose. Accepted dimensions aren't in any API
response; they're only in the drop-zone captions on the version page, so the table holds
just the zones actually read off the screen — 6.5" iPhone, 12.9"/13" iPad, and Apple
Watch. Any display type not in the table skips the dimension check instead of guessing at
it, since a wrong entry would reject a good screenshot. To add one, read its caption in
the browser and transcribe it.

A caption covers several device generations at once and takes any of their sizes, so each
entry is the union of what its caption lists. The watch zone is the awkward case: it names
five generations (Ultra 3, Series 11, 9, 6, 3) with five different sizes but doesn't say
which display type each maps to, so all five `APP_WATCH_*` types accept the union and the
server makes the final call.

## Reading sets back

Screenshot sets are readable only through the collection filtered by localization.
`GET appScreenshotSets/{id}` 404s for a set that demonstrably exists, and
`appScreenshots?filter[appScreenshotSet]=` is refused with a 403. That's why
`findScreenshotSet` takes a localization id rather than a set id.
