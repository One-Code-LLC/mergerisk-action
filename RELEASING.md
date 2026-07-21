# Releasing MergeRisk

This repository publishes a GitHub Action, not an npm package. Keep
`package.json` private to prevent accidental npm publication.

## Prepare a release

1. Choose the next Semantic Versioning release and update `package.json`,
   `package-lock.json`, `CHANGELOG.md`, README examples, and release notes.
2. Run `npm ci`, `npm test`, `npm run typecheck`, and `npm run build`.
   Commit the generated `dist/` changes, then confirm
   `git diff --exit-code -- dist/` succeeds.
3. Merge the release PR to `main`. Confirm CI and the **Release preflight**
   workflow pass for that commit. The preflight is also manually runnable from
   the Actions tab; enter the exact tag, such as `v0.1.2`.
4. Create and push an annotated release tag on the verified `main` commit:

   ```bash
   git tag -a v0.1.2 -m "MergeRisk v0.1.2"
   git push origin v0.1.2
   ```

   The tag push runs the same preflight again and verifies that its version
   matches `package.json`.
5. In GitHub Releases, create a release from the validated tag, paste the
   corresponding file from `docs/releases/`, and make sure **Set as a
   pre-release** is not selected.
6. Move the major compatibility tag to the validated stable release and push it
   with force-with-lease:

   ```bash
   git tag -fa v0 v0.1.2 -m "MergeRisk v0.1.2"
   git push origin v0 --force-with-lease
   ```

7. Verify `One-Code-LLC/mergerisk-action@v0` in a disposable workflow. Then
   update the Marketplace listing details in GitHub, if needed.

Never move `v0` to a pre-release. Do not republish or retag an existing
immutable release tag.
