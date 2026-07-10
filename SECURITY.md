# Security Policy

## Supported Versions

Security updates are provided for the latest released version of Baram.

| Version | Supported |
| ------- | --------- |
| 0.3.x   | ✅        |
| < 0.3   | ❌        |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, report them privately through GitHub's built-in
[private vulnerability reporting](https://github.com/sayinel/baram/security/advisories/new)
(the repository's **Security → Advisories → Report a vulnerability**).

Please include as much of the following as you can:

- A description of the vulnerability and its impact
- Steps to reproduce (a proof of concept if possible)
- Affected version(s) and platform(s)
- Any suggested mitigation

We aim to acknowledge reports within 5 business days and to share a resolution
timeline after triage. Please give us a reasonable window to release a fix
before any public disclosure.

## Scope

Baram is a desktop application. The following areas are of particular interest:

- **AI provider API keys** are stored in the OS keychain (macOS Keychain,
  Windows Credential Manager, Linux Secret Service). Issues that expose or
  mishandle these credentials are in scope.
- **The local LLM proxy** forwards requests to third-party AI providers. Issues
  such as request smuggling, SSRF, or data leakage are in scope.
- **File system / vault access**, **plugin loading**, and **markdown/HTML
  rendering** (e.g. XSS via note content) are in scope.

Vulnerabilities in third-party dependencies should generally be reported
upstream, but we appreciate a heads-up so we can update promptly.

## Recognition

We are happy to credit reporters in the release notes, unless you prefer to
remain anonymous.
