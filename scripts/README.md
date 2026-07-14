# Maintenance scripts

## Version bumping

`bump-version.mjs` is the single cross-platform version bump script.

Use the package scripts:

```bash
pnpm run version:patch
pnpm run version:minor
pnpm run version:major
```

Or invoke it directly when options are needed:

```bash
node scripts/bump-version.mjs patch --no-commit
node scripts/bump-version.mjs minor --skip-changelog
```

Supported options:

- `--no-commit`: update files without creating a Git commit.
- `--skip-changelog`: do not add a release section to `CHANGELOG.md`.

The script updates `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, and `CHANGELOG.md`, then creates a version bump commit unless `--no-commit` is supplied.
