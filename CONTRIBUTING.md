# Contributing to 3Dmol Structure Prediction Viewer

Thank you for your interest in contributing to the 3Dmol Structure Prediction Viewer! This document provides guidelines and instructions for contributing to the project.

## Code of Conduct

We are committed to providing a welcoming and inspiring community for all. Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## How to Contribute

### Reporting Issues

Before opening an issue, please:
1. Check if the issue already exists
2. Provide a clear, descriptive title
3. Include relevant system information (OS, Node.js version, browser version)
4. Attach reproduction steps or example data if applicable
5. Include any relevant error messages or logs

### Suggesting Enhancements

Feature requests are welcome! Please:
1. Use a clear, descriptive title
2. Provide a detailed description of the proposed enhancement
3. Explain the use case and benefits
4. Note any potential drawbacks or implementation challenges

### Submitting Pull Requests

1. **Fork the repository** and create your branch from `main` (or `dev` if available)
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Set up your development environment:**
   ```bash
   npm install
   ```

3. **Make your changes:**
   - Follow the existing code style and conventions
   - Ensure your code is well-commented, especially for non-obvious logic
   - Keep changes focused and atomic

4. **Test your changes:**
   - Manually test the application with your changes
   - Verify no existing functionality is broken
   - Test across different browsers if your changes affect the UI

5. **Commit and push:**
   ```bash
   git commit -m "Description of your changes"
   git push origin feature/your-feature-name
   ```

6. **Open a pull request:**
   - Provide a clear description of the changes
   - Link to any related issues
   - Be responsive to code review feedback

## Development Setup

### Prerequisites
- Node.js 20 or higher
- npm 8 or higher

### Local Development

1. Clone and install:
   ```bash
   git clone https://github.com/AAGI-AUS/3dmol-viewer-ccdm.git
   cd 3dmol-viewer-ccdm
   npm install
   ```

2. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your local configuration
   ```

3. Start the development server:
   ```bash
   export INPUT_DATA_DIR=/path/to/your/data
   export ADMIN_PASSWORD=test-password
   export JWT_SECRET=test-secret
   npm start
   ```

4. Access the application at `http://localhost:3000`

## Code Style

- Use consistent indentation (2 spaces)
- Use meaningful variable and function names
- Write comments for complex logic
- Keep functions focused and reasonably sized
- Follow existing patterns in the codebase

## Commit Message Guidelines

- Use clear, descriptive commit messages
- Reference related issues when applicable (e.g., "Fixes #123")
- Use imperative mood ("Add feature" not "Added feature")
- Keep the first line under 70 characters

## Security

If you discover a security vulnerability, please see our [Security Policy](SECURITY.md) for responsible disclosure guidelines.

## Questions?

Feel free to open a discussion or reach out to the maintainers. We're here to help!

## License

By contributing to this project, you agree that your contributions will be licensed under the same BSD 3-Clause License that covers the project. See [LICENSE](LICENSE) for details.
