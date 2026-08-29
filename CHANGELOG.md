# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Features that are in development

### Changed
- Changes to existing functionality in development

### Fixed
- Bug fixes in development

### Deprecated
- Features that will be removed in a future release

### Removed
- Features that have been removed

### Security
- Security vulnerability fixes

## [1.0.0] - 2026-08-29

### Added
- Initial release of 3Dmol Structure Prediction Viewer
- Multi-method structure comparison (AF3, AlphaFold-Multimer, Boltz-2, Chai-1, ESMFold2)
- Curated pair browser with cross-filtering by plant species, pathogen species, and effector name
- Interface residue detection with configurable distance cutoff
- pLDDT confidence coloring using AlphaFold DB confidence bands
- Sequence viewer panel synced to residue selection
- Live colour pickers for independent structure and interface coloring
- Multiple display styles (Cartoon, Stick, Surface)
- JWT authentication and login system
- Identifier aliasing for cross-method lookups
- AFM resolver with proper ranked model handling
- Quick install script for Ubuntu 22.04
- Comprehensive documentation and API reference

### Security
- JWT token-based authentication with 8-hour expiration
- Environment variable-based credential management
- Password verification via bcryptjs

---

## How to Maintain This Changelog

1. **Add entries** under [Unreleased] as you develop features
2. **Before release**, create a new version section with the release date
3. **Use these categories**:
   - Added (new features)
   - Changed (changes to existing functionality)
   - Fixed (bug fixes)
   - Deprecated (upcoming removals)
   - Removed (deleted features/functionality)
   - Security (security fixes and vulnerability patches)

4. **Version numbering** follows Semantic Versioning:
   - MAJOR: incompatible API changes
   - MINOR: backwards-compatible functionality additions
   - PATCH: backwards-compatible bug fixes

### Example Entry

```markdown
## [1.1.0] - 2026-09-15

### Added
- New feature description

### Fixed
- Bug fix description
```

---

**Previous Versions**: See git tags and releases page for historical releases.
