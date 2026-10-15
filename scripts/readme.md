## Scripts

### Localization

Interface text is read from bundled catalogs; adding or changing a feature does **not** generate translations automatically. Unsupported/missing dynamic UI text falls back to English, then source text. Static HTML without a translation remains unchanged.

Before delivery, run `npm run check:i18n`. It validates all nine complete locales: current UI/HTML strings, helper catalog coverage, extension message keys, placeholders, links, markup and installer paths. Production builds, packaging, CI (`npm test`) and fixed test preparation run the language checks. A missing translation blocks delivery; these commands make no translation API calls.

For a new user-visible string, update all applicable catalogs:

- `src/i18n/ui-*.json`: added interface/HTML text, keyed by Chinese source; Simplified Chinese uses the source text.
- `src/i18n/helper-*.json`: local-helper display messages.
- `src/_locales/*/messages.json`: extension message keys and placeholder definitions.

The legacy `npm run update-locales [locale]` command uses `OPENAI_API_KEY` to generate only missing/empty `_locales` messages from English. It does **not** update UI/helper catalogs, detect changed wording under an existing message key, or prove translation quality. Run it explicitly, inspect the diff and run `npm run check:i18n`. Failure now stops without marking English fallback as a completed translation. Provider retries are bounded and placeholder changes are rejected. Never commit API keys.

`npm run add-locale fr` is also a legacy messages-only operation; it does not qualify a locale for the nine complete-language list.

### Version bump

```bash
./scripts/bump-version.sh 1.0.1
```

- Updates the source version in `package.json` and `package-lock.json`; browser manifests receive it during compilation
- Updates `MARKETING_VERSION` in the Xcode project
- Increments `CURRENT_PROJECT_VERSION` by 1

### Changelog

```bash
./scripts/generate-changelog.sh
```

- Generates `changelogs/<version>.md` from commits since the last git tag
- Reads the version from `package.json`
- Commits starting with "fix" are grouped under an **Improved** section
- Version bump commits are excluded