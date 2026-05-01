# Security

Do not commit credentials, customer data, private repository links, raw PRD exports, or generated requirement packets that contain confidential information.

Before publishing a fork or derived project, run:

```bash
rg -n "secret|token|password|app_secret|private key|BEGIN .*PRIVATE KEY" .
git status --short
```

If a secret was ever committed, remove it from the public export and rotate the credential before publishing.
