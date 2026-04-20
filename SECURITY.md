# 🔒 Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take the security of Evo-Cortex seriously. If you believe you've found a security vulnerability, please follow these steps:

### How to Report

1. **DO NOT** create a public GitHub issue for security vulnerabilities
2. Email us directly at: [your-email@example.com](mailto:your-email@example.com)
3. Include as much detail as possible:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- **Initial Response**: Within 48 hours
- **Status Update**: Within 1 week
- **Resolution Timeline**: Depends on severity, typically 2-4 weeks

### Scope

**In Scope:**
- Core plugin code (`src/`)
- Installation scripts (`scripts/`)
- Memory and knowledge graph systems
- Cron job configurations

**Out of Scope:**
- Third-party dependencies (report to upstream)
- OpenClaw core issues (report to OpenClaw)
- User configuration errors

## Security Best Practices

### For Users

1. **Keep Updated**: Always use the latest version
2. **Review Permissions**: Understand what the plugin can access
3. **Monitor Logs**: Check for unusual activity
4. **Backup Data**: Regular backups of memory and knowledge files

### For Contributors

1. **No Secrets in Code**: Never commit API keys, tokens, or credentials
2. **Validate Input**: Always sanitize user input
3. **Secure Dependencies**: Keep npm dependencies updated
4. **Code Review**: All changes reviewed before merging

## Known Limitations

- Memory files are stored locally (not encrypted by default)
- Knowledge graph is plaintext JSON
- No built-in access control (relies on OpenClaw security)

## Security Updates

Security updates will be released as patch versions (e.g., 1.0.1) and announced via:
- GitHub Releases
- npm changelog
- Security advisories (if critical)

---

Thank you for helping keep Evo-Cortex secure! 🦞
