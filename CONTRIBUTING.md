# 🤝 Contributing to Evo-Cortex

First off, thank you for considering contributing to Evo-Cortex! It's people like you that make Evo-Cortex such a great tool.

## 📋 Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct. By participating, you are expected to uphold this code.

## 🗺️ Getting Started

### Where do I go from here?

If you've noticed a bug or have a feature request, [search the issue tracker](https://github.com/luoboask/evo-cortex/issues) to see if someone else has already created an issue. If not, feel free to create a new one!

### Fork & Clone

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/evo-cortex.git
   cd evo-cortex
   ```

3. Create a branch for your work:
   ```bash
   git checkout -b feature/your-feature-name
   ```

### Setting Up Development Environment

```bash
# Install dependencies
npm install

# Run tests (if available)
npm test

# Build the project (if needed)
npm run build
```

## 🔄 Making Changes

### Commit Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat:` A new feature
- `fix:` A bug fix
- `docs:` Documentation only changes
- `style:` Changes that do not affect the meaning of the code
- `refactor:` A code change that neither fixes a bug nor adds a feature
- `perf:` A code change that improves performance
- `test:` Adding missing tests or correcting existing tests
- `chore:` Changes to the build process or auxiliary tools

Example:
```bash
git commit -m "feat: add semantic search caching"
git commit -m "fix: resolve memory leak in session scanner"
```

### Pull Request Process

1. Update the README.md or documentation with details of changes if appropriate
2. Update PUBLISH_SUCCESS.md with release notes if adding features
3. Make sure your code passes all tests
4. Squash your commits into logical units of work
5. Submit the PR and wait for review

## 📝 Reporting Bugs

Before creating bug reports, please check the issue tracker as you might find out that you don't need to create one. When you are creating a bug report, please include as many details as possible:

* **Use a clear and descriptive title**
* **Describe the exact steps which reproduce the problem**
* **Provide specific examples to demonstrate the steps**
* **Describe the behavior you observed after following the steps**
* **Explain which behavior you expected to see instead and why**
* **Include screenshots if possible**
* **Include Node.js version, OS, OpenClaw version**

## ✨ Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, please include:

* **Use a clear and descriptive title**
* **Provide a detailed description of the suggested enhancement**
* **Explain why this enhancement would be useful**
* **List some examples of how this enhancement would be used**

## 🎨 Style Guides

### TypeScript Style Guide

- Follow the existing code style
- Use meaningful variable names
- Add comments for complex logic
- Keep functions small and focused
- Use TypeScript types properly

### Documentation Style Guide

- Use Markdown formatting
- Keep language simple and clear
- Include code examples where appropriate
- Update relevant sections when making changes

## 🚀 Release Process

Releases use semantic versioning (MAJOR.MINOR.PATCH):

- **MAJOR**: Breaking changes
- **MINOR**: New features (backwards compatible)
- **PATCH**: Bug fixes (backwards compatible)

To release a new version:

1. Update version in package.json
2. Update CHANGELOG.md
3. Create a git tag: `git tag v1.0.1`
4. Push tag: `git push origin v1.0.1`
5. Publish to npm: `npm publish`

## 💬 Questions?

Feel free to open an issue with the "question" label or join our discussions!

---

Thank you for contributing to Evo-Cortex! 🦞
