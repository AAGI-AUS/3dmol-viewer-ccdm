# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.1] - 2026-11-19

### Added
- Export from the viewer: images, video, structure files and FASTA, with a save
  dialog where the browser supports it and a ZIP fallback where it doesn't (#5)
- Multi-select plant and pathogen species filters, and a Clear Filters button (#4, #10)
- Prediction scores for every method, with a comparison table grouped into
  global, interface and per-chain metrics, and an Extended tab for the raw
  per-direction values (#12, #22)
- Copy FASTA buttons for each chain in the sequence panel (#17)
- Light and dark themes with colour-blind-safe palettes (#19)
- Sequence tracks coloured by pLDDT when pLDDT colouring is on (#25)
- AlphaFold 3 terms of use: a notice in the viewer, a terms panel, hosted copies of the
  Output Terms of Use and the Legally Binding Terms of Use, and the notice on exported
  images, videos and score tables (#27)
- Help button pointing questions and requests to the repository issues

### Changed
- Chain A is labelled as the effector and chain B as the target throughout (#8)
- Only the best-ranked model of each method is served; the model selector is gone (#21)
- The sequence panel is shown by default and follows the interface highlight (#12)

### Fixed
- AlphaFold 3 now shows the top-ranked model instead of always showing `seed-1_sample-0`,
  so the structure matches the scores shown beside it (#28)
- Chai-1 now shows its top model (highest `aggregate_score`) instead of always showing
  `pred.model_idx_0`, for the same reason (#28)
- Species filter selections no longer reset silently (#4)
- Exported files keep their names instead of downloading as "Unconfirmed" or `.txt` (#5)

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
