# Security Policy

## Reporting a Security Vulnerability

We take security seriously. If you believe you have discovered a security vulnerability in the 3Dmol Structure Prediction Viewer, please report it to us responsibly.

**Please do NOT open a public issue for security vulnerabilities.**

### How to Report

Please send a detailed report to: **kristina.gagalova@gmail.com**

Include the following information:
- Description of the vulnerability
- Steps to reproduce (if applicable)
- Potential impact and severity
- Any proof-of-concept code or screenshots
- Your contact information

### What to Expect

1. **Acknowledgment**: We will acknowledge receipt of your report within 48 hours
2. **Investigation**: We will investigate and validate the vulnerability
3. **Timeline**: We aim to address security issues within 30 days
4. **Notification**: Once a fix is available, we will notify you and provide an opportunity to verify the fix before public disclosure
5. **Credit**: We will acknowledge your responsible disclosure (unless you prefer anonymity)

## Security Guidelines

### Best Practices for Deployment

- **Environment Variables**: Always set `ADMIN_PASSWORD` and `JWT_SECRET` as environment variables, never hardcode them
- **HTTPS**: Deploy with HTTPS enabled (see installation guide for Let's Encrypt setup)
- **Network Security**: Restrict network access to authorized sources if possible
- **Regular Updates**: Keep Node.js and all dependencies up to date
- **Monitoring**: Monitor logs for unusual activity via `sudo journalctl -u 3dmol -f`

### Credentials

- Credentials should never be committed to the repository
- `.env` files are in `.gitignore` and should not be tracked
- Use systemd service environment variables for production credentials
- Rotate secrets periodically

### Authentication

- The application uses JWT tokens with an 8-hour expiration
- Tokens are signed using `JWT_SECRET` — use a long, random secret in production
- Password is verified against `ADMIN_PASSWORD` environment variable
- Future versions should implement database-backed user management (see README)

### Data Protection

- Input validation is performed on all API endpoints
- Structure files are read from disk and served as-is
- Metadata TSV is parsed and served based on authentication
- No sensitive data is logged in the application

## Vulnerability Disclosure Policy

We follow responsible disclosure practices:
1. Issues are fixed before public disclosure
2. Security advisories are published after fixes are available
3. We work with researchers to understand and remediate issues
4. We provide adequate time for users to upgrade before public details are released

## Security Considerations for Contributors

- Do not add dependencies without security review
- Avoid logging sensitive data (passwords, tokens, etc.)
- Sanitize user input before processing
- Use parameterized queries if implementing database features
- Keep cryptographic functions updated with best practices

## Supported Versions

Security updates are provided for:
- **Current version**: Full support including security patches
- **Previous version**: Limited security patch support
- **Older versions**: No security support — please upgrade

## Additional Security Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/nodejs-security/)
- [NPM Security Documentation](https://docs.npmjs.com/packages-and-modules/security)

## Acknowledgments

We appreciate the security research community and responsible disclosure practices. Thank you for helping keep this project secure.
