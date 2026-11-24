# Security Policy

## Supported Versions

We are committed to maintaining the security of HELPDESK.AI. The following versions of the project are currently being supported with security updates:

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |
| < Latest| :x:                |

## Reporting a Vulnerability

We take the security of HELPDESK.AI seriously. If you believe you have found a security vulnerability, please report it to us as described below.

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via email to the project maintainer at:
- **LinkedIn**: [Ritesh](https://www.linkedin.com/in/ritesh1908/)
- **GitHub**: [@riteshbonthalakoti](https://github.com/riteshbonthalakoti)

### What to Include

When reporting a vulnerability, please include:

1. **Type of vulnerability** (e.g., SQL injection, cross-site scripting, etc.)
2. **Full paths of source file(s)** related to the manifestation of the issue
3. **The location of the affected source code** (tag/branch/commit or direct URL)
4. **Any special configuration required** to reproduce the issue
5. **Step-by-step instructions** to reproduce the issue
6. **Proof-of-concept or exploit code** (if possible)
7. **Impact of the issue**, including how an attacker might exploit it

### Response Timeline

- **Acknowledgment**: We will acknowledge receipt of your vulnerability report within 48 hours.
- **Initial Assessment**: We will provide an initial assessment of the report within 5 business days.
- **Updates**: We will keep you informed of the progress towards a fix and full announcement.
- **Resolution**: We aim to resolve critical vulnerabilities within 30 days of confirmation.

## Disclosure Policy

When we receive a security bug report, we will:

1. Confirm the problem and determine the affected versions
2. Audit code to find any potentially similar problems
3. Prepare fixes for all supported versions
4. Release fixes as soon as possible

## Comments on This Policy

If you have suggestions on how this process could be improved, please submit a pull request or contact the project maintainer.

## Security Best Practices for Contributors


- **Never commit sensitive data** (API keys, passwords, tokens, etc.)
- **Use environment variables** for configuration secrets
- **Validate all user inputs** before processing
- **Sanitize outputs** to prevent XSS attacks
- **Keep dependencies updated** to patch known vulnerabilities
- **Use HTTPS** for all API communications
- **Implement proper authentication and authorization** checks

## Responsible Disclosure

We encourage responsible disclosure of security vulnerabilities. If you follow the reporting guidelines above, we will:

- Work with you to understand and validate the issue
- Provide appropriate acknowledgment for your discovery
- Ensure the vulnerability is properly addressed

Thank you for helping keep HELPDESK.AI and its users safe!